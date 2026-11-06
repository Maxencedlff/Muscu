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
blocage ; __sb.meId() : compte connecté. Réactions (supabase/migrations/20261031200000_reactions_profil.sql) :
__sb.so.bravos = [{ owner, sid, user, kind, at }] (kind 👏 par défaut), __sb.react(user, owner, sid, kind)
en pose une ; set_reaction, my_reactions, session_reactions, my_activity, mark_activity_seen et
my_shown_sessions suivent la migration (réaction comptée tant que son auteur voit la séance, activité vue
dans __sb.so.seenAt). Appels dans __sb.calls sous ['social', fonction, arguments].
__sb.fail.social = 'offline' : toutes les RPC du social échouent comme supabase-js hors ligne.
Commentaires (supabase/migrations/20261031500000_commentaires.sql) : list_comments, add_comment, delete_comment,
report_comment avec les mêmes règles (propriétaire ou abonné qui voit la séance, auteur qui voit encore la
séance, blocage, masqué au 3e signalement sauf pour son auteur, ligne de __sb.so.reports dont l'id est renvoyé
pour l'alerte { report_id } de la fonction Edge report ; deux mots interdits seulement : connard, fuck), lignes « comment » de my_activity et pastille. État dans __sb.so.comments ; __sb.comment(auteur,
propriétaire, séance, texte) en pose un.

Coach (docs/COACH_V1.md) : coach_state, coach_create_invite, coach_revoke_invite, coach_preview, coach_join,
coach_leave, coach_remove_student, coach_student_sessions (liste blanche session_for_coach, 30 par page),
coach_mark_seen, coach_send_programme, coach_set_note, student_inbox, student_mark_seen, avec leurs erreurs
(not_coach, invalid_code, already_coached, not_found sur son propre code, team_full, rate_limited, too_long,
invalid_programme, username_required sans pseudo), comme supabase/migrations/20261027100000_coach.sql : badge_coach et
badge_student (badge = leur somme), new_sessions depuis le lien tant que le coach n'a rien ouvert, 10 aperçus ou
adhésions réussis par heure, rejoindre le même coach renvoie le coach, coach_preview avec since null. Élève retiré :
listé dans removed, ses codes de ce coach répondent invalid_code jusqu'à coach_allow_student(student).
students[].sent : programmes que je lui ai envoyés, { id, sent_at, seen }.
Rôle coach (tarifs du 30/10, docs/PAYANT_V1.md) : coach_request_state, coach_request_submit (invalid_name,
invalid_card, invalid_diploma, already_coach, rate_limited 5 par 24 h), coach_tier_state, coach_my_code, fonction
Edge coach-request-alert (__sb.co.alerts) ; codes de 8 ou 12 caractères ; un élève de trop : tier_full (verrou
allumé : limite de la formule coach, 0 sans formule ; éteint : 50, ou plus selon le palier).
État dans __sb.co ; __sb.makeCoach(id) valide le rôle (coach_at, code permanent, demande « approved »),
__sb.rejectCoach(id, motif) refuse la demande, __sb.setTier(id, produit) pose la formule coach,
__sb.link(coach, élève) relie deux comptes. Appels dans
__sb.calls sous ['coach', fonction, arguments] ; __sb.fail.coach = 'offline' pour le hors ligne.
Messages (supabase/migrations/20261031510000_chat_coach.sql) : chat_threads, chat_messages (before_id, after_id),
chat_send (écrire ne vaut pas lecture), chat_mark_read (up_to), report_chat (copie des 50 derniers messages dans
__sb.co.chatReports, gardée après la rupture du lien, et ligne de __sb.so.reports) ; une conversation par lien,
effacée quand le lien est rompu. État dans __sb.co.msgs et __sb.co.reads ; __sb.msg(élève, deCoach, texte) en dépose un ; __sb.fail.chat = 'missing' (PGRST202 : serveur
sans messagerie) ou 'offline'.

Partage avec le coach (supabase/migrations/20261031300000_partage_coach.sql) : student_shares,
student_set_share (weight seulement : invalid_kind sinon ; not_found sans coach), student_share_weights
(not_shared sans consentement, remplace la liste), coach_student_weights (not_found si pas mon élève) ;
coach_student_sessions ajoute bodyKg (dernière pesée partagée au plus tard à la date) seulement avec le
consentement. Quitter ou être retiré efface consentement et pesées. État dans __sb.co.shares et
__sb.co.weights ; __sb.share(élève, [{ date, kg }]) coche le poids et dépose des pesées.
Mensurations (supabase/migrations/20261105010000_partage_mensurations.sql) : student_shares annonce kinds
(['weight', 'measures']), student_set_share accepte 'measures', student_share_measures (not_shared sans
consentement, remplace tout, mesures connues seulement), coach_student_measures ; état dans __sb.co.measures ;
__sb.shareMeasures(élève, { waist: [{ date, cm }] }) coche et dépose ; __sb.fail.measures = 'missing' : serveur
d'avant (pas de kinds, invalid_kind, PGRST202).
Planification (supabase/migrations/20261105000000_coach_planning.sql) : coach_plans, student_plan (sans la
note ni l'identifiant des phases), coach_plan_save (invalid_phase, too_long, overlap, too_many à 30, not_found), coach_plan_delete ; effacée
avec le lien. État dans __sb.co.phases ; __sb.addPhase(élève, { goal, start, weeks, name?, prog_name?, note? })
en pose une ; __sb.fail.plan = 'missing' (PGRST202 : serveur sans planification) ou 'offline'.
Progression (supabase/migrations/20261106000000_coach_progression.sql) : coach_progress (séances des 35 derniers
jours avec leurs records notés, first_at, last_record_at, unnoted_at sur 182 jours, mes élèves seulement, encore
coach) ; __sb.fail.progress = 'missing' (PGRST202 : serveur sans la fonction, l'app lit les séances page par page).

Parrainage (docs/PARRAINAGE.md, supabase/migrations/20261031400000_parrainage.sql) : referral_state et
referral_apply avec les mêmes règles (un parrain par compte, fixé à la première saisie, 30 jours après la
création du compte, 10 essais par 24 h échecs compris, code inconnu ou inactif → { ok: false, error:
'invalid_code' }, autres refus en erreur). État dans __sb.rf : codes partners { CODE: { name, active } }
(LUCAS actif, VIEUX inactif au départ), attributions links { compte: CODE }. Appels dans __sb.calls sous
['referral', fonction, arguments] ; __sb.fail.referral = 'offline' pour le hors ligne.

Lettre d'information (docs/NEWSLETTER.md, supabase/migrations/20261031230000_newsletter.sql) : newsletter_state,
newsletter_subscribe(consent_version) (no_email pour un compte sans adresse, comme Apple seul ; invalid_version, rate_limited 20 par 24 h, horodatage du SERVEUR) et
newsletter_unsubscribe (jamais limitée, la ligne est supprimée) ; l'état dit has_email. État dans __sb.nl.subs (par compte) ; appels dans
__sb.calls sous ['newsletter', fonction, arguments] ; __sb.fail.newsletter = 'offline' pour le hors ligne.

Strava (docs/STRAVA.md) : RPC strava_status et fonctions Edge strava-connect (adresse d'autorisation factice),
strava-export (validation de supabase/functions/_shared/strava-policy.js résumée, une activité par séance,
already au second envoi, not_connected sans liaison) et strava-disconnect (revoked selon __sb.st.revokeFails).
État dans __sb.st ; __sb.stravaAuthorize() simule l'accord donné dans Safari (prénom Léa), __sb.stravaRevokeAtStrava()
l'accès retiré chez Strava. Corps reçus dans __sb.st.sent. __sb.fail.strava = 'offline' pour le hors ligne.

Notifications push (docs/NOTIFICATIONS.md) : module MdlfPush (autorisation d'iOS __sb.push.permission :
'prompt' | 'granted' | 'denied', réponse à la fenêtre __sb.push.answer, faux jeton __sb.push.token, '' :
inscription refusée par iOS) ; RPC push_prefs, push_set_prefs (null = inchangé), push_register (jeton
vérifié comme la migration), push_unregister, push_release (jeton d'un autre compte seulement). État dans __sb.push (prefs, devices) ; appels dans __sb.calls
sous ['push', fonction, arguments] ; __sb.fail.push = 'offline' pour le hors ligne.
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
    push: Object.assign({ permission: 'prompt', answer: 'granted', token: 'ab'.repeat(32), prefs: {}, devices: {} }, opts.push || {}),
  };
  const log = (...a) => sb.calls.push(a);
  const err = (code, message = code, status = 400) => ({ name: 'AuthApiError', code, message, status });

  // ── Coquille iOS ──
  window.Capacitor = {
    isNativePlatform: () => true,
    // MdlfAgeRange seulement avec __fakeOpts.ageRange (réponse d'AgeRangePlugin.swift) : sinon build sans le module
    isPluginAvailable: name => name === 'MdlfAccount' || (name === 'MdlfAgeRange' && !!opts.ageRange),
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
      if (name === 'MdlfPush') return {
        permission: async () => ({ permission: sb.push.permission }),
        requestPermission: async () => { log('push', 'request'); if (sb.push.permission === 'prompt') sb.push.permission = sb.push.answer; return { permission: sb.push.permission }; },
        register: async () => { log('push', 'register'); if (sb.push.permission !== 'granted' || !sb.push.token) { const e = new Error('refusé'); e.code = 'REGISTER_FAILED'; throw e; } return { token: sb.push.token, environment: 'production' }; },
        openSettings: async () => { log('push', 'openSettings'); return { opened: true }; },
        addListener: async (ev, cb) => { (sb.push.listeners ||= {})[ev] = cb; return { remove: () => {} }; },
      };
      if (name === 'MdlfAgeRange') return { request: async () => { log('age', 'request'); return opts.ageRange; } };
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
  const so = sb.so = { at: {}, follows: [], blocks: [], bravos: [], posts: {}, reports: [], day: {}, seenAt: {}, comments: [] };
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
  sb.react = (user, owner, sid, kind = 'clap', at = now()) => {
    so.bravos = so.bravos.filter(b => !(b.owner === owner && b.sid === sid && b.user === user));
    so.bravos.push({ owner, sid, user, kind, at });
  };
  const KINDS = ['clap', 'fire', 'strong', 'trophy', 'wow'];
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
  // tech et sub par série, grip par exercice : migration 20261106100000_seance_publique_intensif_prise.sql
  // (private.set_tech, private.set_sub, private.exercise_grip), mêmes listes blanches et bornes
  const subW = v => (typeof v === 'string' && /^(|\d{1,3}(\.\d{1,3})?|1000(\.0{1,3})?)$/.test(v)) || (typeof v === 'number' && v >= 0 && v <= 1000) ? v : undefined;
  const subR = v => (typeof v === 'string' && /^([1-9]\d{0,2}|[1-3]\d{3}|4000)$/.test(v)) || (Number.isInteger(v) && v >= 1 && v <= 4000) ? v : undefined;
  const pubSub = v => {
    if (!Array.isArray(v)) return undefined;
    const out = v.slice(0, 6).filter(x => x && typeof x === 'object' && !Array.isArray(x) && subR(x.reps) !== undefined
      && (x.weight == null || subW(x.weight) !== undefined)).map(x => ({ weight: subW(x.weight), reps: subR(x.reps) }));
    return out.length ? out : undefined;
  };
  const pubTech = st => {
    if (st.warmup === true) return {};
    if (st.tech === 'top' || st.tech === 'backoff') return { tech: st.tech };
    const sub = ['drop', 'rp', 'cluster'].includes(st.tech) ? pubSub(st.sub) : undefined;
    return sub ? { tech: st.tech, sub } : {};
  };
  const GRIP_OK = { hand: ['pronation', 'supination', 'neutre', 'mixte', 'crochet'], width: ['serree', 'moyenne', 'large'], tool: ['barre', 'ez', 'triangle', 'poignees', 'corde', 'v'] };
  const pubGrip = g => {
    if (!g || typeof g !== 'object' || Array.isArray(g)) return undefined;
    const o = {};
    for (const [k, list] of Object.entries(GRIP_OK)) if (list.includes(g[k])) o[k] = g[k];
    return Object.keys(o).length ? o : undefined;
  };
  const pubSet = st => {
    const sc = v => (['string', 'number', 'boolean'].includes(typeof v) ? v : undefined);
    return { weight: sc(st.weight), reps: sc(st.reps), dist: sc(st.dist), warmup: st.warmup === true ? true : undefined,
      rir: Number.isInteger(st.rir) && st.rir >= 0 && st.rir <= 4 ? st.rir : undefined, ...pubTech(st) };
  };
  // withBefore : valeur d'avant gardée pour le coach seulement (private.session_records(v, true))
  const pubRecords = (v, withBefore = false) => {
    if (!Array.isArray(v)) return undefined;
    const n = x => typeof x === 'number' && x >= 0 && x <= 100000, D = [0.5, 1, 2, 5, 10];
    return v.slice(0, 20).filter(r => r && typeof r === 'object' && typeof r.ex === 'string' && r.ex.trim()
      && ['charge', 'reps', 'lest', 'aide', 'temps', 'duree', 'distance', 'allure'].includes(r.kind) && n(r.before) && n(r.after)
      && (r.kind !== 'allure' || D.includes(r.d)))
      .map(r => ({ ex: r.ex.slice(0, 80), kind: r.kind, before: withBefore ? r.before : undefined, after: r.after, w: n(r.w) ? r.w : undefined, d: D.includes(r.d) ? r.d : undefined }));
  };
  const sessionPublic = d => {
    const sc = v => (['string', 'number', 'boolean'].includes(typeof v) ? v : undefined);
    const strip = o => JSON.parse(JSON.stringify(o));
    return strip({ date: sc(d.date), duration: sc(d.duration), programme: sc(d.programme), category: sc(d.category), label: sc(d.label),
      records: pubRecords(d.records),
      exercises: (d.exercises || []).map(e => ({ name: sc(e.name), measure: sc(e.measure), grip: pubGrip(e.grip), sets: (e.sets || []).map(pubSet) })) });
  };
  const limit = (me, action, max) => { const k = me + action; so.day[k] = (so.day[k] || 0) + 1; return so.day[k] > max; };
  const bravoCount = (owner, sid) => so.bravos.filter(b => b.owner === owner && b.sid === sid).length;
  // Réactions qui comptent : auteur qui voit encore la séance (private.reaction_counts)
  const countsOf = (owner, sid) => {
    const c = {};
    for (const b of so.bravos) if (b.owner === owner && b.sid === sid && canSee(b.user, owner)) c[b.kind || 'clap'] = (c[b.kind || 'clap'] || 0) + 1;
    return c;
  };
  const total = c => Object.values(c).reduce((a, n) => a + n, 0);
  const myKind = (owner, sid, me) => so.bravos.find(b => b.owner === owner && b.sid === sid && b.user === me)?.kind || null;
  const iso = t => new Date(t).toISOString();
  const seenOf = me => so.seenAt[me] || so.at[me] || 0;
  const activityNew = me => !so.at[me] ? 0
    : so.bravos.filter(b => b.owner === me && b.at > seenOf(me) && canSee(b.user, me) && myPosts(me).some(p => p.id === b.sid && !p.deleted_at)).length
      + so.follows.filter(f => f.follower === me && f.status === 'accepted' && f.at > seenOf(me) && so.at[f.followee] && !blockedBetween(me, f.followee)).length
      + commentsNew(me, seenOf(me));
  const norm = q => String(q || '').trim().replace(/^@+/, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  // ── Commentaires (supabase/migrations/20261031500000_commentaires.sql) ──
  // so.comments = [{ id, owner, sid, user, body, at, masked, reporters }] ; __sb.comment(user, owner, sid, body) en pose un.
  // Mots interdits : deux mots suffisent pour le chemin de refus (la vraie liste est testée en SQL)
  let commentN = 0;
  const COMMENT_BANNED = ['connard', 'fuck'];
  sb.comment = (user, owner, sid, body, at = now()) => {
    const c = { id: ++commentN, owner, sid, user, body, at, masked: false, reporters: [] };
    so.comments.push(c); return c.id;
  };
  const commentPost = (owner, sid) => postsOf(owner).find(x => x.id === sid);
  const commentReadable = (me, owner, sid) => { const p = commentPost(owner, sid);
    return !!p && !p.deleted_at && ((me === owner && !!so.at[me]) || (canSee(me, owner) && shown(p))); };
  const commentWritable = (me, owner, sid) => { const p = commentPost(owner, sid);
    return !!p && shown(p) && ((me === owner && !!so.at[me]) || canSee(me, owner)); };
  const commentShown = (me, c) => (c.user === c.owner || canSee(c.user, c.owner)) && !blockedBetween(me, c.user) && (!c.masked || c.user === me);
  const commentRow = (me, c) => ({ id: c.id, user_id: c.user, username: sb.profiles[c.user]?.username || null, avatar: sb.profiles[c.user]?.avatar_emoji || null,
    body: c.body, at: new Date(c.at).toISOString(), mine: c.user === me, can_delete: c.user === me || c.owner === me, masked: c.masked });
  const commentClean = t => String(t ?? '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').replace(/^[ \t\n]+|[ \t\n]+$/g, '');
  const commentsNew = (me, seen) => so.comments.filter(c => c.owner === me && c.user !== me && !c.masked && c.at > seen && canSee(c.user, me)
    && myPosts(me).some(p => p.id === c.sid && !p.deleted_at)).length;
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
        blocked: so.blocks.filter(k => k.blocker === me).map(k => (so.at[k.blocked] ? person(k.blocked, k.at) : { ...person(k.blocked, k.at), username: null, avatar: null })), badge: pend.length,
        activity_new: Math.min(99, activityNew(me)), shown_sessions: myPosts(me).filter(shown).length };
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
          s: sessionPublic(p.data), bravos: total(countsOf(o, p.id)), my_bravo: !!myKind(o, p.id, me), reactions: countsOf(o, p.id), my_reaction: myKind(o, p.id, me) }));
    },
    toggle_bravo: (me, { owner, session_id }) => {
      const p = postsOf(owner).find(x => x.id === session_id);
      if (owner === me || !so.at[me] || !canSee(me, owner) || !p || !shown(p)) return pgErr('not_found');
      if (limit(me, 'bravo', 200)) return pgErr('rate_limited');
      const i = so.bravos.findIndex(b => b.owner === owner && b.sid === session_id && b.user === me);
      if (i >= 0) so.bravos.splice(i, 1); else so.bravos.push({ owner, sid: session_id, user: me, kind: 'clap', at: now() });
      return { bravos: bravoCount(owner, session_id), mine: i < 0 };
    },
    set_reaction: (me, { owner, session_id, kind }) => {
      if (kind != null && !KINDS.includes(kind)) return pgErr('invalid_reaction');
      const p = postsOf(owner).find(x => x.id === session_id);
      if (owner === me || !so.at[me] || !canSee(me, owner) || !p || !shown(p)) return pgErr('not_found');
      const cur = myKind(owner, session_id, me);
      if (kind == null) so.bravos = so.bravos.filter(b => !(b.owner === owner && b.sid === session_id && b.user === me));
      else if (cur !== kind) { if (limit(me, 'bravo', 200)) return pgErr('rate_limited'); sb.react(me, owner, session_id, kind); }
      const c = countsOf(owner, session_id);
      return { bravos: total(c), mine: kind != null, my_reaction: kind ?? null, reactions: c };
    },
    my_reactions: me => [...new Set(so.bravos.filter(b => b.owner === me).map(b => b.sid))]
      .filter(sid => myPosts(me).some(p => p.id === sid && !p.deleted_at))
      .map(sid => { const c = countsOf(me, sid); const top = Object.keys(c).sort((a, b) => c[b] - c[a] || KINDS.indexOf(a) - KINDS.indexOf(b))[0];
        return { session_id: sid, total: total(c), top, reactions: c }; })
      .filter(r => r.total > 0),
    session_reactions: (me, { session_id }) => so.bravos.filter(b => b.owner === me && b.sid === session_id && canSee(b.user, me))
      .sort((a, b) => b.at - a.at)
      .map(b => ({ user_id: b.user, username: sb.profiles[b.user]?.username || null, avatar: sb.profiles[b.user]?.avatar_emoji || null, kind: b.kind, at: iso(b.at) })),
    my_activity: (me, { before_at = null, before_key = null } = {}) => {
      if (!so.at[me]) return [];
      const seen = seenOf(me);
      const pr = id => ({ user_id: id, username: sb.profiles[id]?.username || null, avatar: sb.profiles[id]?.avatar_emoji || null });
      const posts = myPosts(me);
      const rows = [
        ...so.bravos.filter(b => b.owner === me && canSee(b.user, me)).map(b => ({ b, p: posts.find(x => x.id === b.sid && !x.deleted_at) })).filter(x => x.p)
          .map(({ b, p }) => ({ kind: 'reaction', ...pr(b.user), at: b.at, reaction: b.kind, session_id: b.sid, session_label: p.data.label || null, session_at: p.data.date, is_new: b.at > seen })),
        ...so.comments.filter(c => c.owner === me && c.user !== me && !c.masked && !c.reporters.includes(me) && canSee(c.user, me)).map(c => ({ c, p: posts.find(x => x.id === c.sid && !x.deleted_at) })).filter(x => x.p)
          .map(({ c, p }) => ({ kind: 'comment', ...pr(c.user), at: c.at, session_id: c.sid, session_label: p.data.label || null, session_at: p.data.date,
            comment_id: c.id, comment_text: c.body.slice(0, 120), is_new: c.at > seen })),
        ...so.follows.filter(f => f.followee === me && f.status === 'accepted' && so.at[f.follower] && !blockedBetween(me, f.follower))
          .map(f => ({ kind: 'follower', ...pr(f.follower), at: f.at, is_new: false })),
        ...so.follows.filter(f => f.follower === me && f.status === 'accepted' && so.at[f.followee] && !blockedBetween(me, f.followee))
          .map(f => ({ kind: 'accepted', ...pr(f.followee), at: f.at, is_new: f.at > seen })),
        ...so.follows.filter(f => f.followee === me && f.status === 'pending' && !blockedBetween(me, f.follower))
          .map(f => ({ kind: 'request', ...pr(f.follower), at: f.at, is_new: false })),
      ];
      // Curseur (at, clé kind:user_id:session_id), comme le serveur : à date égale, clé croissante
      const key = r => (r.kind === 'comment' ? `comment:${r.user_id}:${r.session_id}:${r.comment_id}` : `${r.kind}:${r.user_id}:${r.session_id || ''}`);
      const before = before_at ? Date.parse(before_at) : Infinity;
      return rows.filter(r => r.at < before || (before_key != null && r.at === before && key(r) > before_key))
        .sort((a, b) => b.at - a.at || (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0)).slice(0, 50)
        .map(r => ({ reaction: null, session_id: null, session_label: null, session_at: null, comment_id: null, comment_text: null, ...r, at: iso(r.at) }));
    },
    list_comments: (me, { owner, session_id, before_id = null }) => {
      if (!commentReadable(me, owner, session_id)) return [];
      return so.comments.filter(c => c.owner === owner && c.sid === session_id && (before_id == null || c.id < before_id) && commentShown(me, c)
        && !c.reporters.includes(me))
        .sort((a, b) => b.id - a.id).slice(0, 30).map(c => commentRow(me, c));
    },
    add_comment: (me, { owner, session_id, body }) => {
      const t = commentClean(body);
      if (!t) return pgErr('empty_comment');
      if ([...t].length > 500) return pgErr('too_long');
      if (!so.at[me]) return pgErr('social_not_enabled');
      if (!commentWritable(me, owner, session_id)) return pgErr('not_found');
      if (COMMENT_BANNED.some(w => t.toLowerCase().includes(w))) return pgErr('comment_forbidden');
      if (limit(me, 'comment', 150)) return pgErr('rate_limited');
      const id = sb.comment(me, owner, session_id, t);
      return commentRow(me, so.comments.find(c => c.id === id));
    },
    delete_comment: (me, { comment_id }) => {
      const c = so.comments.find(x => x.id === comment_id && (x.user === me || x.owner === me));
      if (!c) return false;
      so.comments.splice(so.comments.indexOf(c), 1); return true;
    },
    report_comment: (me, { comment_id, reason }) => {
      if (!['spam', 'harcelement', 'sexuel', 'violence', 'haine', 'autre'].includes(reason)) return pgErr('invalid_reason');
      const c = so.comments.find(x => x.id === comment_id);
      if (!c || c.user === me || !commentReadable(me, c.owner, c.sid) || !commentShown(me, c)) return pgErr('not_found');
      if (c.reporters.includes(me)) return null;
      if (so.reports.filter(r => r.by === me).length >= 10) return pgErr('rate_limited');
      c.reporters.push(me);
      if (c.reporters.length >= 3) c.masked = true;
      // File commune (public.reports) : l'app en demande l'alerte à la fonction Edge report ({ report_id })
      so.reports.push({ id: so.reports.length + 1, by: me, target_user: c.user, kind: 'session', target_ref: `comment_reports:${c.id}`, reason, details: c.body.slice(0, 500), notified: false });
      return so.reports.length;
    },
    mark_activity_seen: me => { so.seenAt[me] = now(); return null; },
    my_shown_sessions: (me, { before_at = null, before_id = null } = {}) => myPosts(me).filter(shown)
      .filter(p => before_at == null || p.data.date < before_at || (p.data.date === before_at && before_id != null && p.id < before_id))
      .sort((a, b) => b.data.date - a.data.date || (a.id < b.id ? 1 : -1)).slice(0, 20)
      .map(p => { const c = countsOf(me, p.id);
        return { owner: me, username: sb.profiles[me]?.username || null, avatar: sb.profiles[me]?.avatar_emoji || null, id: p.id, done_at: p.data.date,
          s: sessionPublic(p.data), bravos: total(c), my_bravo: false, reactions: c, my_reaction: null }; }),
    my_bravos: me => [...new Set(so.bravos.filter(b => b.owner === me).map(b => b.sid))].map(sid => ({ session_id: sid, bravos: bravoCount(me, sid) })),
  };
  const callSocial = async (fn, args = {}) => {
    log('social', fn, JSON.stringify(args));
    if (sb.fail.social === 'offline') return { data: null, error: { message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' } };
    if (sb.fail.social === 'hang') return new Promise(() => {});
    const me = sb.meId();
    if (!me) return { data: null, error: { code: '42501', message: 'permission denied' } };
    // Bravos posés directement par un test (sans sorte ni date) : 👏 d'à l'instant, comme la valeur par défaut du serveur
    so.bravos.forEach(b => { b.kind ||= 'clap'; b.at ||= now(); });
    const out = socialRpc[fn](me, args);
    return out && out.error !== undefined && out.data === null ? out : { data: out, error: null };
  };

  // ── Coach (docs/COACH_V1.md) ──
  // État dans __sb.co : coachs (coach_at), codes, liens élève → coach (coach_seen_at), programmes envoyés, commentaires
  const co = sb.co = { coachAt: {}, invites: [], links: [], progs: [], notes: [], tries: {}, sends: {}, codeN: 0, bans: [], shares: [], weights: {}, measures: {}, phases: [], phaseN: 0, msgs: [], reads: {}, chatReports: [],
    requests: {}, reqTries: {}, tierProduct: {}, permCode: {}, alerts: 0 };
  // Partage : consentement { student, coach, kind, granted_at } du coach actuel ; pesées par élève (du plus récent)
  const shareOf = (student, kind = 'weight') => co.shares.find(x => x.student === student && x.kind === kind && x.coach === linkOf(student)?.coach);
  const dropShares = student => { co.shares = co.shares.filter(x => x.student !== student); delete co.weights[student]; delete co.measures[student]; };
  const mCount = m => Object.values(m || {}).reduce((a, l) => a + l.length, 0);
  const mLast = m => Math.max(0, ...Object.values(m || {}).map(l => l[0]?.date || 0)) || null;
  const sharesState = me => ({ coach: !!linkOf(me), ...(sb.fail.measures === 'missing' ? {} : { kinds: ['weight', 'measures', ...(opts.dietServerless ? [] : ['diet'])] }),
    shares: Object.fromEntries(co.shares.filter(x => x.student === me && x.coach === linkOf(me)?.coach)
    .map(x => [x.kind, x.kind === 'measures' ? { granted_at: x.granted_at, n: mCount(co.measures[me]), last_at: mLast(co.measures[me]) }
      : { granted_at: x.granted_at, n: (co.weights[me] || []).length, last_at: (co.weights[me] || [])[0]?.date ?? null }])) });
  const MEASURE_KEYS = ['chest', 'waist', 'hips', 'shoulders', 'neck', 'armL', 'armR', 'thighL', 'thighR', 'calf'];
  sb.shareMeasures = (student, measures = {}) => {
    if (!shareOf(student, 'measures')) co.shares.push({ student, coach: linkOf(student).coach, kind: 'measures', granted_at: new Date(now()).toISOString() });
    co.measures[student] = Object.fromEntries(Object.entries(measures).map(([k, l]) => [k, l.slice().sort((a, b) => b.date - a.date)]));
  };
  // Planification : phases { id, student, coach, name, goal, start, weeks, prog_name, note } du lien actuel
  const PLAN_GOALS = ['bulk', 'cut', 'mini_cut', 'maintain', 'comeback', 'strength', 'prep', 'deload', 'other'];
  const dayN = iso => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400_000;
  // Coach : avec id et note ; élève (student_plan) : ni id, ni note
  const phaseJson = (p, note) => ({ ...(note ? { id: p.id } : {}), name: p.name, goal: p.goal, start: p.start, weeks: p.weeks, prog_name: p.prog_name, ...(note ? { note: p.note, updated_at: p.updated_at } : {}) });
  const planOf = (coachId, student) => co.phases.filter(p => p.coach === coachId && p.student === student)
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.id - b.id)).map(p => phaseJson(p, true));
  sb.addPhase = (student, ph) => {
    const p = { id: ++co.phaseN, student, coach: linkOf(student).coach, name: '', prog_name: null, note: '', updated_at: new Date(now()).toISOString(), ...ph };
    co.phases.push(p); return p.id;
  };
  const dropPhases = student => { co.phases = co.phases.filter(p => p.student !== student); };
  sb.share = (student, weights = []) => {
    if (!shareOf(student)) co.shares.push({ student, coach: linkOf(student).coach, kind: 'weight', granted_at: new Date(now()).toISOString() });
    co.weights[student] = weights.slice().sort((a, b) => b.date - a.date);
  };
  const CODE_ABC12 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  // Rôle validé par l'administrateur (private.approve_coach) : coach_at posé, code permanent de 12 caractères
  sb.makeCoach = id => {
    co.coachAt[id] = now();
    if (!co.permCode[id]) {
      let code = ''; const n = Object.keys(co.permCode).length + 3;
      for (let i = 0; i < 12; i++) code += CODE_ABC12[(n * 11 + i * 7 + i * i * 3) % 32];
      co.permCode[id] = code;
      co.invites.push({ code, coach: id, expires: Infinity, permanent: true });
    }
    if (co.requests[id]) Object.assign(co.requests[id], { status: 'approved', decided_at: new Date(now()).toISOString() });
  };
  // Refus ou retrait par l'administrateur (private.reject_coach, private.revoke_coach)
  sb.rejectCoach = (id, reason) => { if (co.requests[id]) Object.assign(co.requests[id], { status: 'rejected', reason, decided_at: new Date(now()).toISOString() }); };
  // Formule coach en cours chez Apple (abonnement vérifié par le serveur) : sa limite d'élèves
  sb.setTier = (id, product) => { co.tierProduct[id] = product; };
  const TIER_LIMIT = { coach10: 10, coach20: 20, coach30: 30, coachmax: null };
  const TIER_ORDER = ['coach10', 'coach20', 'coach30', 'coachmax'];
  const tierKey = product => { const m = /^com\.mdlf\.training\.(coach\w+)\.(monthly|yearly)$/.exec(product || ''); return m && m[1] in TIER_LIMIT ? m[1] : null; };
  // Limite d'élèves : verrou allumé, celle de la formule coach (0 sans formule) ; éteint, 50 comme avant
  // sauf palier plus haut. null : illimité
  const limitOf = coachId => {
    const k = tierKey(co.tierProduct[coachId]);
    const lim = k ? TIER_LIMIT[k] : 0;
    if (window.__st && window.__st.paywallOn) return lim;
    return lim === null ? null : Math.max(50, lim);
  };
  // seen : coach_seen_at (null tant que le coach n'a rien ouvert : new_sessions comptées depuis le lien)
  sb.link = (coachId, student, at = now()) => { co.links.push({ coach: coachId, student, at, seen: null }); };
  const linkOf = student => co.links.find(l => l.student === student);
  // L'élève de ce coach, et je suis encore coach (private.coach_require_student)
  const coachOf = (me, student) => { const l = linkOf(student); return l && l.coach === me && co.coachAt[me] ? l : null; };
  const cperson = (id, since) => ({ ...person(id, since || 0), since: since == null ? null : new Date(since).toISOString() });
  const validInvite = code => co.invites.find(i => i.code === code && i.expires > now());
  const CODE_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  // private.session_for_coach : liste blanche du social + notes, hidden, id, records avec before (jamais bodyKg ni healthSaved)
  const sessionForCoach = (id, d) => {
    const sc = v => (['string', 'number', 'boolean'].includes(typeof v) ? v : undefined);
    return JSON.parse(JSON.stringify({ ...sessionPublic(d), records: pubRecords(d.records, true), notes: sc(d.notes), hidden: sc(d.hidden), id,
      exercises: (d.exercises || []).map(e => ({ name: sc(e.name), measure: sc(e.measure), ss: sc(e.ss), grip: pubGrip(e.grip), sets: (e.sets || []).map(pubSet) })) }));
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
    const lim = limitOf(inv.coach);
    if (!cur && lim !== null && co.links.filter(l => l.coach === inv.coach).length >= lim) return 'tier_full';
    (co.tries[me] ||= []).push(now());
    return inv;
  };
  // private.coach_session_body : bodyKg seulement si l'élève me partage son poids
  const withBodyKg = (me, student, at, s) => {
    const sh = shareOf(student);
    const w = sh && sh.coach === me ? (co.weights[student] || []).find(x => x.date <= at) : null;
    return w ? { ...s, bodyKg: w.kg } : s;
  };
  // ── Messages coach ↔ élève (supabase/migrations/20261031510000_chat_coach.sql) ──
  // co.msgs = [{ id, student, coach, fromCoach, body, at }] ; co.reads[élève] = { coach, student } (dernier id lu) ;
  // __sb.msg(élève, deCoach, texte) en dépose un ; __sb.fail.chat = 'missing' : serveur sans messagerie (PGRST202)
  let msgN = 0;
  sb.msg = (student, fromCoach, body, at = now()) => {
    const l = linkOf(student); const m = { id: ++msgN, student, coach: l.coach, fromCoach, body, at };
    co.msgs.push(m); return m.id;
  };
  const dropChat = student => { co.msgs = co.msgs.filter(m => m.student !== student); delete co.reads[student]; };
  const chatThread = (me, student) => {
    if (student == null) { const l = linkOf(me); return l && co.coachAt[l.coach] ? { s: me, c: l.coach, asCoach: false } : null; }
    const l = linkOf(student);
    return student !== me && l && l.coach === me && co.coachAt[me] ? { s: student, c: me, asCoach: true } : null;
  };
  const chatMsgs = th => co.msgs.filter(m => m.student === th.s && m.coach === th.c).sort((a, b) => a.id - b.id);
  const chatRead = (th, asCoach) => (co.reads[th.s] || {})[asCoach ? 'coach' : 'student'] || 0;
  const chatRow = (th, m) => ({ id: m.id, mine: m.fromCoach === th.asCoach, body: m.body, at: new Date(m.at).toISOString() });
  const chatSummary = th => {
    const ms = chatMsgs(th), last = ms[ms.length - 1];
    return { unread: ms.filter(m => m.fromCoach !== th.asCoach && m.id > chatRead(th, th.asCoach)).length,
      last: last ? { ...chatRow(th, last), body: last.body.slice(0, 120) } : null };
  };
  const chatMark = (th, id) => { const r = co.reads[th.s] ||= { coach: 0, student: 0 }; const k = th.asCoach ? 'coach' : 'student'; r[k] = Math.max(r[k], id); };
  const coachRpc = {
    chat_threads: me => {
      const mine = chatThread(me, null);
      const students = co.coachAt[me] ? co.links.filter(l => l.coach === me).map(l => ({ student_id: l.student, ...chatSummary({ s: l.student, c: me, asCoach: true }) })) : [];
      const coachT = mine ? chatSummary(mine) : null;
      return { coach: coachT, students, unread: (coachT?.unread || 0) + students.reduce((a, x) => a + x.unread, 0) };
    },
    chat_messages: (me, { student = null, before_id = null, after_id = null } = {}) => {
      const th = chatThread(me, student); if (!th) return pgErr('not_found');
      const ms = chatMsgs(th);
      if (after_id != null) return ms.filter(m => m.id > after_id).slice(0, 50).map(m => chatRow(th, m));
      return ms.filter(m => before_id == null || m.id < before_id).reverse().slice(0, 50).map(m => chatRow(th, m));
    },
    chat_send: (me, { body, student = null }) => {
      const th = chatThread(me, student); if (!th) return pgErr('not_found');
      const t = String(body ?? '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').replace(/^[ \t\n]+|[ \t\n]+$/g, '');
      if (!t) return pgErr('empty_message');
      if ([...t].length > 2000) return pgErr('too_long');
      if (limit(me, 'chat', 500)) return pgErr('rate_limited');
      // Écrire ne vaut pas lecture (pas de marque)
      const id = sb.msg(th.s, th.asCoach, t);
      return chatRow(th, co.msgs.find(m => m.id === id));
    },
    chat_mark_read: (me, { student = null, up_to = null } = {}) => {
      const th = chatThread(me, student); if (!th) return pgErr('not_found');
      const ms = chatMsgs(th).filter(m => up_to == null || m.id <= up_to); chatMark(th, ms.length ? ms[ms.length - 1].id : 0); return null;
    },
    // Copie des 50 derniers messages (co.chatReports, gardée après la rupture du lien) et ligne de la file commune
    report_chat: (me, { reason, student = null } = {}) => {
      if (!['spam', 'harcelement', 'sexuel', 'violence', 'haine', 'autre'].includes(reason)) return pgErr('invalid_reason');
      const th = chatThread(me, student); if (!th) return pgErr('not_found');
      if (sb.so.reports.filter(r => r.by === me).length >= 10) return pgErr('rate_limited');
      const other = th.asCoach ? th.s : th.c;
      co.chatReports.push({ by: me, target: other, reason, messages: chatMsgs(th).slice(-50).map(m => ({ id: m.id, from_coach: m.fromCoach, body: m.body })) });
      sb.so.reports.push({ id: sb.so.reports.length + 1, by: me, target_user: other, kind: 'profile', target_ref: `chat_reports:${co.chatReports.length}`, reason, notified: false });
      return sb.so.reports.length;
    },
    student_shares: me => sharesState(me),
    // 'diet' : plans diète du coach (20261106200000) ; opts.dietServerless simule un serveur d'avant
    student_set_share: (me, { kind, enabled }) => {
      // Serveur à jour : poids, mensurations (sb.fail.measures === 'missing' : serveur d'avant) et plans diète
      // (opts.dietServerless : serveur d'avant 20261106200000)
      const open = [...(sb.fail.measures === 'missing' ? ['weight'] : ['weight', 'measures']), ...(opts.dietServerless ? [] : ['diet'])];
      if (!open.includes(kind) || typeof enabled !== 'boolean') return pgErr('invalid_kind');
      const l = linkOf(me); if (!l) return pgErr('not_found');
      if (enabled && !shareOf(me, kind)) co.shares.push({ student: me, coach: l.coach, kind, granted_at: new Date(now()).toISOString() });
      if (!enabled) {
        co.shares = co.shares.filter(x => !(x.student === me && x.kind === kind));
        if (kind === 'weight') delete co.weights[me]; else if (kind === 'measures') delete co.measures[me];
        // Retrait de l'accord diète : les plans diète gardés pour l'élève sont effacés (déclencheur)
        else if (kind === 'diet') co.progs = co.progs.filter(p => !(p.student === me && p.id.startsWith('diet_')));
      }
      return sharesState(me);
    },
    student_share_measures: (me, { measures }) => {
      if (!shareOf(me, 'measures')) return pgErr('not_shared');
      if (!measures || typeof measures !== 'object' || Array.isArray(measures)) return pgErr('invalid_data');
      const es = Object.entries(measures);
      if (es.some(([k, l]) => !MEASURE_KEYS.includes(k) || !Array.isArray(l))) return pgErr('invalid_data');
      if (es.some(([, l]) => l.length > 400)) return pgErr('too_long');
      if (es.some(([, l]) => l.some(v => !v || !Number.isInteger(v.date) || typeof v.cm !== 'number' || v.cm < 10 || v.cm > 250))) return pgErr('invalid_data');
      co.measures[me] = Object.fromEntries(es.filter(([, l]) => l.length).map(([k, l]) => [k, l.map(v => ({ date: v.date, cm: Math.round(v.cm * 10) / 10 })).sort((a, b) => b.date - a.date)]));
      return mCount(co.measures[me]);
    },
    coach_student_measures: (me, { student }) => {
      if (!coachOf(me, student)) return pgErr('not_found');
      const sh = shareOf(student, 'measures');
      return sh ? { shared: true, since: sh.granted_at, measures: co.measures[student] || {} } : { shared: false, since: null, measures: {} };
    },
    // Même règles que supabase/migrations/20261106000000_coach_progression.sql
    coach_progress: me => {
      if (!co.coachAt[me]) return { students: [] };
      const D = 86400_000, maxAt = now() + D, from = now() - 35 * D, hz = now() - 182 * D;
      return { students: co.links.filter(l => l.coach === me).map(l => {
        const ps = livePosts(l.student).filter(p => p.data.date <= maxAt && p.data.date >= hz).sort((a, b) => (b.data.date - a.data.date) || (a.id < b.id ? 1 : -1));
        return { student_id: l.student,
          sessions: ps.filter(p => p.data.date >= from).slice(0, 80).map(p => ({ at: p.data.date, records: Array.isArray(p.data.records) ? JSON.parse(JSON.stringify(pubRecords(p.data.records, true))) : null })),
          first_at: ps.length ? ps[ps.length - 1].data.date : null,
          last_record_at: ps.find(p => (pubRecords(p.data.records) || []).length)?.data.date ?? null,
          unnoted_at: ps.find(p => !Array.isArray(p.data.records))?.data.date ?? null };
      }) };
    },
    coach_plans: me => ({ students: co.coachAt[me] ? co.links.filter(l => l.coach === me).map(l => ({ student_id: l.student, phases: planOf(me, l.student) })) : [] }),
    student_plan: me => { const l = linkOf(me); return { coach: !!l, phases: l ? co.phases.filter(p => p.coach === l.coach && p.student === me)
      .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.id - b.id)).map(p => phaseJson(p, false)) : [] }; },
    coach_plan_save: (me, { student, phase_id = null, name = '', goal, start_date, weeks, programme = null, note = '' }) => {
      if (!coachOf(me, student)) return pgErr('not_found');
      if (!PLAN_GOALS.includes(goal) || !/^\d{4}-\d{2}-\d{2}$/.test(start_date || '') || !Number.isInteger(weeks) || weeks < 1 || weeks > 52) return pgErr('invalid_phase');
      const n = String(name || '').trim().replace(/\s+/g, ' '), pg = String(programme || '').trim() || null, nt = String(note || '').trim();
      if (n.length > 40 || (pg || '').length > 40 || nt.length > 500) return pgErr('too_long');
      const s0 = dayN(start_date), e0 = s0 + weeks * 7;
      const mine = co.phases.filter(p => p.coach === me && p.student === student);
      if (mine.some(p => p.id !== phase_id && dayN(p.start) < e0 && s0 < dayN(p.start) + p.weeks * 7)) return pgErr('overlap');
      if (phase_id == null) {
        if (mine.length >= 30) return pgErr('too_many');
        co.phases.push({ id: ++co.phaseN, student, coach: me, name: n, goal, start: start_date, weeks, prog_name: pg, note: nt, updated_at: new Date(now()).toISOString() });
      } else {
        const p = mine.find(x => x.id === phase_id); if (!p) return pgErr('not_found');
        Object.assign(p, { name: n, goal, start: start_date, weeks, prog_name: pg, note: nt, updated_at: new Date(now()).toISOString() });
      }
      return planOf(me, student);
    },
    coach_plan_delete: (me, { student, phase_id }) => {
      if (!coachOf(me, student)) return pgErr('not_found');
      co.phases = co.phases.filter(p => !(p.coach === me && p.student === student && p.id === phase_id));
      return planOf(me, student);
    },
    student_share_weights: (me, { weights }) => {
      if (!shareOf(me)) return pgErr('not_shared');
      if (!Array.isArray(weights)) return pgErr('invalid_data');
      if (weights.length > 400) return pgErr('too_long');
      if (weights.some(w => !w || !Number.isInteger(w.date) || typeof w.kg !== 'number' || w.kg < 25 || w.kg > 300)) return pgErr('invalid_data');
      co.weights[me] = weights.map(w => ({ date: w.date, kg: Math.round(w.kg * 100) / 100 })).sort((a, b) => b.date - a.date);
      return co.weights[me].length;
    },
    coach_student_weights: (me, { student }) => {
      if (!coachOf(me, student)) return pgErr('not_found');
      const sh = shareOf(student);
      return sh ? { shared: true, since: sh.granted_at, weights: co.weights[student] || [] } : { shared: false, since: null, weights: [] };
    },
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
        invites: isCoach ? co.invites.filter(i => i.coach === me && i.expires > now()).map(i => ({ code: i.code, expires_at: i.permanent ? 'infinity' : new Date(i.expires).toISOString() })) : [],
        removed: isCoach ? co.bans.filter(b => b.coach === me).sort((a, b) => b.at - a.at).map(b => cperson(b.student, b.at)) : [],
        badge_coach: badgeCoach, badge_student: unseen, badge: badgeCoach + unseen };
    },
    coach_create_invite: me => {
      if (!co.coachAt[me]) return pgErr('not_coach');
      const mine = co.invites.filter(i => i.coach === me && i.expires > now() && !i.permanent);
      if (mine.length >= 5) co.invites.splice(co.invites.indexOf(mine[0]), 1);
      let code = ''; const n = ++co.codeN;
      for (let i = 0; i < 8; i++) code += CODE_ABC[(n * 7 + i * 13 + i * i) % CODE_ABC.length];
      co.invites.push({ code, coach: me, expires: now() + 7 * 86400_000 });
      return code;
    },
    // Rôle coach : demande vérifiée à la main, palier, code permanent (tarifs du 30/10)
    coach_request_state: me => ({ status: 'none', ...(co.requests[me] || {}), is_coach: !!co.coachAt[me] }),
    coach_request_submit: (me, { card_name, card_number, diploma }) => {
      if (co.coachAt[me]) return pgErr('already_coach');
      const name = String(card_name || '').trim(), card = String(card_number || '').toUpperCase().replace(/[\s-]/g, ''), dip = String(diploma || '').trim();
      if (name.length < 2 || name.length > 80) return pgErr('invalid_name');
      if (!/^[A-Z0-9]{6,20}$/.test(card)) return pgErr('invalid_card');
      if (dip.length < 2 || dip.length > 80) return pgErr('invalid_diploma');
      const tries = (co.reqTries[me] || []).filter(t => t > now() - 86400_000);
      if (tries.length >= 5) return pgErr('rate_limited');
      co.reqTries[me] = [...tries, now()];
      co.requests[me] = { status: 'pending', card_name: name, card_number: card, diploma: dip, reason: null,
        created_at: new Date(now()).toISOString(), decided_at: null };
      return { ...co.requests[me], is_coach: false };
    },
    coach_tier_state: me => {
      if (!co.coachAt[me]) return { is_coach: false, paywall_on: !!(window.__st && __st.paywallOn), product_id: null, limit: 0, students: 0, full: true, next_product: null };
      const k = tierKey(co.tierProduct[me]), lim = limitOf(me), n = co.links.filter(l => l.coach === me).length;
      const next = TIER_ORDER[k ? TIER_ORDER.indexOf(k) + 1 : 0];
      return { is_coach: true, paywall_on: !!(window.__st && __st.paywallOn), product_id: k ? co.tierProduct[me] : null, limit: lim, students: n,
        full: lim !== null && n >= lim, next_product: next ? `com.mdlf.training.${next}.monthly` : null };
    },
    coach_my_code: me => (co.coachAt[me] ? { code: co.permCode[me], created_at: new Date(co.coachAt[me]).toISOString() } : pgErr('not_coach')),
    coach_revoke_invite: (me, { code }) => { co.invites = co.invites.filter(i => !(i.coach === me && i.code === code)); return null; },
    coach_preview: (me, { code }) => { const r = joinCheck(me, code); return typeof r === 'string' ? pgErr(r) : cperson(r.coach, null); },
    coach_join: (me, { code }) => {
      const r = joinCheck(me, code); if (typeof r === 'string') return pgErr(r);
      if (!linkOf(me)) sb.link(r.coach, me);
      return cperson(r.coach, linkOf(me).at);
    },
    coach_leave: me => { dropShares(me); dropChat(me); dropPhases(me); co.links = co.links.filter(l => l.student !== me); co.progs = co.progs.filter(p => p.student !== me); co.notes = co.notes.filter(n => n.student !== me); return null; },
    // Retirer un accès est toujours permis, même si mon rôle de coach a été retiré
    coach_remove_student: (me, { student }) => {
      const l = linkOf(student);
      if (!l || l.coach !== me) return null;
      if (!co.bans.some(b => b.coach === me && b.student === student)) co.bans.push({ coach: me, student, at: now() });
      dropShares(student); dropChat(student); dropPhases(student);
      co.links = co.links.filter(l => l.student !== student); co.progs = co.progs.filter(p => p.student !== student); co.notes = co.notes.filter(n => n.student !== student); return null;
    },
    coach_student_sessions: (me, { student, before_at = null, before_id = null }) => {
      if (!coachOf(me, student)) return pgErr('not_found');
      const key = p => [p.data.date, p.id];
      const cmp = (a, b) => (a[0] - b[0]) || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);
      return livePosts(student).filter(p => before_at == null || cmp(key(p), [before_at, before_id || '']) < 0)
        .sort((a, b) => cmp(key(b), key(a))).slice(0, 30)
        .map(p => ({ id: p.id, done_at: p.data.date, s: withBodyKg(me, student, p.data.date, sessionForCoach(p.id, p.data)), note: co.notes.find(n => n.student === student && n.sid === p.id)?.text || null }));
    },
    coach_allow_student: (me, { student }) => { co.bans = co.bans.filter(b => !(b.coach === me && b.student === student)); return null; },
    coach_mark_seen: (me, { student }) => { const l = coachOf(me, student); if (!l) return pgErr('not_found'); l.seen = now(); return null; },
    coach_send_programme: (me, { student, prog_id, data }) => {
      if (!co.coachAt[me]) return pgErr('not_coach');
      if (!coachOf(me, student)) return pgErr('not_found');
      if (typeof prog_id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(prog_id) || !data || typeof data !== 'object' || Array.isArray(data)) return pgErr('invalid_programme');
      if (JSON.stringify(data).length > 200 * 1024) return pgErr('too_long');
      if (prog_id.startsWith('diet_') && !opts.dietServerless && !shareOf(student, 'diet')) return pgErr('diet_not_accepted');
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
    if (fn.startsWith('chat_') && sb.fail.chat === 'missing') return { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${fn}`, details: null, hint: null } };
    if (fn.startsWith('chat_') && sb.fail.chat === 'offline') return { data: null, error: { message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' } };
    if (fn === 'coach_progress' && sb.fail.progress === 'missing') return { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${fn}`, details: null, hint: null } };
    const planFn = ['coach_plans', 'student_plan', 'coach_plan_save', 'coach_plan_delete'].includes(fn);
    const measFn = ['student_share_measures', 'coach_student_measures'].includes(fn);
    if ((planFn && sb.fail.plan === 'missing') || (measFn && sb.fail.measures === 'missing')) return { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${fn}`, details: null, hint: null } };
    if (planFn && sb.fail.plan === 'offline') return { data: null, error: { message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' } };
    const me = sb.meId();
    if (!me) return { data: null, error: { code: '42501', message: 'permission denied' } };
    const out = coachRpc[fn](me, args);
    return out && out.error !== undefined && out.data === null ? out : { data: out, error: null };
  };
  // ── Parrainage ──
  const rf = sb.rf = { partners: { LUCAS: { name: 'Lucas', active: true }, VIEUX: { name: 'Ancien', active: false } }, links: {}, tries: {} };
  const rfUntil = me => Date.parse(sb.users[me].created_at) + 30 * 86400_000;
  const rfReferrer = me => { const c = rf.links[me]; return c ? { name: rf.partners[c.code].name, since: new Date(c.at).toISOString() } : null; };
  const referralRpc = {
    referral_state: me => ({ referrer: rfReferrer(me), can_enter: !rf.links[me] && now() < rfUntil(me), until: new Date(rfUntil(me)).toISOString() }),
    referral_apply: (me, { code }) => {
      const c = String(code || '').toUpperCase().replace(/[\s.\-_]/g, '');
      if (rf.links[me]) return rf.links[me].code === c ? { ok: true, referrer: rfReferrer(me) } : pgErr('already_referred');
      if (now() >= rfUntil(me)) return pgErr('too_late');
      const t = rf.tries[me] = (rf.tries[me] || []).filter(x => x > now() - 86400_000);
      if (t.length >= 10) return pgErr('rate_limited');
      t.push(now());
      const p = rf.partners[c];
      if (!p || !p.active) return { ok: false, error: 'invalid_code' };
      rf.links[me] = { code: c, at: now() };
      return { ok: true, referrer: rfReferrer(me) };
    },
  };
  const callReferral = async (fn, args = {}) => {
    log('referral', fn, JSON.stringify(args));
    if (sb.fail.referral === 'offline') return { data: null, error: { message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' } };
    const me = sb.meId();
    if (!me) return { data: null, error: { code: '42501', message: 'permission denied' } };
    const out = referralRpc[fn](me, args);
    return out && out.error !== undefined && out.data === null ? out : { data: out, error: null };
  };
  // Lettre d'information : la ligne n'existe que pendant l'inscription
  const nl = sb.nl = { subs: {}, tries: {} };
  const nlHasEmail = me => !!String(sb.users[me]?.email || '').trim();
  const nlJson = me => { const s = nl.subs[me]; return { subscribed: !!s, consented_at: s ? s.at : null, version: s ? s.version : null, has_email: nlHasEmail(me) }; };
  const nlRpc = {
    newsletter_state: me => nlJson(me),
    newsletter_subscribe: (me, { consent_version }) => {
      if (!nlHasEmail(me)) return pgErr('no_email');
      const v = String(consent_version ?? '').trim();
      if (!/^v[0-9]{1,3}$/.test(v)) return pgErr('invalid_version');
      const tries = (nl.tries[me] || []).filter(t => t > now() - 86400_000);
      if (tries.length >= 20) return pgErr('rate_limited');
      nl.tries[me] = [...tries, now()];
      nl.subs[me] = { at: new Date(now()).toISOString(), version: v };
      return nlJson(me);
    },
    newsletter_unsubscribe: me => { delete nl.subs[me]; return nlJson(me); },
  };
  const callNewsletter = async (fn, args = {}) => {
    log('newsletter', fn, JSON.stringify(args));
    if (sb.fail.newsletter === 'offline') return { data: null, error: { message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' } };
    const me = sb.meId();
    if (!me) return { data: null, error: { code: '42501', message: 'permission denied' } };
    const out = nlRpc[fn](me, args);
    return out && out.error !== undefined && out.data === null ? out : { data: out, error: null };
  };
  const REPORT_REASONS = ['spam', 'harcelement', 'sexuel', 'violence', 'haine', 'autre'];

  // ── Strava ──
  const st = sb.st = { connected: false, name: null, canWrite: true, exports: {}, sent: [], nextId: 16000000001, revokeFails: false, starts: 0 };
  sb.stravaAuthorize = (name = 'Léa') => { st.connected = true; st.name = name; st.canWrite = true; };
  sb.stravaRevokeAtStrava = () => { st.revokedAtStrava = true; };
  const SPORTS = ['WeightTraining', 'Workout', 'Run', 'TrailRun', 'Walk', 'Ride', 'Rowing', 'Elliptical', 'StairStepper'];
  const stravaStatus = () => ({ connected: st.connected, athlete_name: st.connected ? st.name : null, connected_at: null,
    can_write: st.connected && st.canWrite, exports: st.connected ? Object.entries(st.exports).map(([session_id, activity_id]) => ({ session_id, activity_id })) : [] });
  // ── Notifications push : comme supabase/migrations/20261031900000_notifications_push.sql et 20261031910000_notifications_messages.sql ──
  // Serveur à jour : 5 types (20261031910000) ; __fakeOpts.pushOldServer : les 3 d'avant
  const PUSH_PREF_KEYS = opts.pushOldServer ? ['reactions', 'follows', 'coach'] : ['reactions', 'follows', 'coach', 'comments', 'messages'];
  const pushPrefs = id => { const p = sb.push.prefs[id] || {}; return Object.fromEntries(PUSH_PREF_KEYS.map(k => [k, p[k] === true])); };
  const pushRpc = {
    push_prefs: me => pushPrefs(me),
    push_set_prefs: (me, a) => {
      // PostgREST : la version dont les noms d'arguments sont exactement ceux envoyés, sinon 404 (PGRST202)
      if (Object.keys(a).sort().join() !== [...PUSH_PREF_KEYS].sort().join()) return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.push_set_prefs' } };
      const p = pushPrefs(me); for (const k of PUSH_PREF_KEYS) if (a[k] !== null && a[k] !== undefined) p[k] = !!a[k]; sb.push.prefs[me] = p; return pushPrefs(me);
    },
    push_register: (me, a) => { if (!/^[0-9a-f]{64,200}$/.test(a.token || '') || !['production', 'sandbox'].includes(a.env)) return { data: null, error: { code: 'P0001', message: 'invalid_token' } }; sb.push.devices[a.token] = me; return null; },
    push_unregister: (me, a) => { if (sb.push.devices[a.token] === me) delete sb.push.devices[a.token]; return null; },
    push_release: (me, a) => { if (sb.push.devices[a.token] && sb.push.devices[a.token] !== me) delete sb.push.devices[a.token]; return null; },
  };
  const callPush = async (fn, args) => {
    log('push', fn, JSON.stringify(args || {}));
    if (sb.fail.push === 'offline') return { data: null, error: { message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' } };
    const me = sb.meId();
    if (!me) return { data: null, error: { code: '42501', message: 'permission denied' } };
    const out = pushRpc[fn](me, args || {});
    return out && out.error !== undefined && out.data === null ? out : { data: out, error: null };
  };

  window.supabase = {
    createClient: (url, key, o) => {
      sb.storage = o?.auth?.storage; sb.storageKey = o?.auth?.storageKey;
      return {
        auth, from,
        rpc: async (fn, args) => {
          if (fn === 'strava_status') {
            log('strava', fn, '{}');
            if (sb.fail.strava === 'offline') return { data: null, error: { message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' } };
            return sb.session ? { data: stravaStatus(), error: null } : { data: null, error: { code: '42501', message: 'permission denied' } };
          }
          if (socialRpc[fn]) return callSocial(fn, args); if (coachRpc[fn]) return callCoach(fn, args); if (referralRpc[fn]) return callReferral(fn, args); if (nlRpc[fn]) return callNewsletter(fn, args); if (pushRpc[fn]) return callPush(fn, args); log('rpc', fn, args?.name); return { data: !sb.taken.includes(args.name) && !Object.values(sb.profiles).some(p => p.username === args.name), error: null }; },
        functions: { invoke: async (fn, { body } = {}) => {
          log('invoke', fn, JSON.stringify(body || {}));
          const fail = (status, b) => ({ data: null, error: { name: 'FunctionsHttpError', message: 'Edge Function returned a non-2xx status code', context: { status, json: async () => b } } });
          if (fn === 'coach-request-alert') {
            if (!sb.session) return fail(401, { error: 'auth' });
            co.alerts++;
            return { data: { ok: true, notified: true }, error: null };
          }
          if (fn.startsWith('strava-')) {
            if (sb.fail.strava === 'offline') throw new TypeError('Failed to fetch');
            if (!sb.session) return fail(401, { error: 'auth' });
            const b = body || {};
            if (fn === 'strava-connect') { st.starts++; return { data: { url: 'https://www.strava.com/oauth/authorize?client_id=12345&redirect_uri=https%3A%2F%2Fexemple.supabase.co%2Ffunctions%2Fv1%2Fstrava-connect&response_type=code&approval_prompt=force&scope=activity%3Awrite&state=etat-factice' }, error: null }; }
            if (fn === 'strava-disconnect') { const was = st.connected; st.connected = false; st.exports = {}; st.name = null; return { data: { ok: true, revoked: !was || !st.revokeFails }, error: null }; }
            // strava-export
            if (typeof b.session_id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(b.session_id) || !SPORTS.includes(b.sport_type)
              || !Number.isInteger(b.elapsed_time) || b.elapsed_time < 60 || b.elapsed_time > 86400 || typeof b.name !== 'string' || !b.name.trim()
              || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/.test(b.start_date_local || '')) return fail(400, { error: 'invalid' });
            if (!st.connected) return fail(409, { error: 'not_connected' });
            if (st.revokedAtStrava) { st.connected = false; st.exports = {}; st.revokedAtStrava = false; return fail(409, { error: 'not_connected' }); }
            if (st.exports[b.session_id]) return { data: { ok: true, activity_id: st.exports[b.session_id], already: true }, error: null };
            st.sent.push(b);
            const id = String(st.nextId++);
            st.exports[b.session_id] = id;
            return { data: { ok: true, activity_id: id }, error: null };
          }
          if (fn === 'report') {
            if (sb.fail.social === 'offline') throw new TypeError('Failed to fetch');
            if (!sb.session) return fail(401, { error: 'auth' });
            const b = body || {};
            // Alerte d'un signalement déjà enregistré (report_comment, report_chat) : la ligne doit être à moi
            if ('report_id' in b) {
              if (!Number.isSafeInteger(b.report_id) || b.report_id <= 0 || Object.keys(b).length !== 1) return fail(400, { error: 'invalid', field: 'report_id' });
              const row = so.reports.find(r => r.id === b.report_id && r.by === sb.meId());
              if (row) row.notified = true;
              return { data: { ok: true }, error: null };
            }
            if (!sb.users[b.target_user]) return fail(404, { error: 'not_found' });
            if (b.target_user === sb.meId() || !['profile', 'session'].includes(b.kind) || !REPORT_REASONS.includes(b.reason)
              || (b.details != null && String(b.details).length > 500)) return fail(400, { error: 'invalid' });
            if (so.reports.filter(r => r.by === sb.meId()).length >= 10) return fail(429, { error: 'rate_limited' });
            so.reports.push({ ...b, id: so.reports.length + 1, by: sb.meId(), notified: true });
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
