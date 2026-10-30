// Amis (js/data/social.js) : logique pure sans réseau (nettoyage de ce que renvoie le serveur,
// recherche, relation, erreurs traduites)
export default function ({ test, run, assert, sameJSON }) {
  test('amis : séance d\'un autre réduite à la liste blanche, champs bornés', () => {
    const s = run(`cleanPublicSession({ date: 1e12, duration: 3e6, programme: 'ppl', category: 'push', label: 'Push', notes: 'privé', bodyKg: 80, hidden: true, extra: 1,
      exercises: [{ name: 'DC', measure: 'reps', muscles: ['x'], sets: [{ weight: 80, reps: '8', rpe: 9 }, null] }, { name: '' }, 'x'] })`);
    sameJSON(Object.keys(s).sort(), ['category', 'date', 'duration', 'exercises', 'label', 'programme']);
    sameJSON(s.exercises, [{ name: 'DC', measure: 'reps', sets: [{ weight: '80', reps: '8' }] }]);
    assert.equal(run(`cleanPublicSession({}).label`), 'Séance', 'nom absent : « Séance »');
    // Ligne du fil inutilisable (sans propriétaire, sans date) : écartée
    assert.equal(run(`cleanFeedRow({ id: 'a', s: {} })`), null);
    const row = run(`cleanFeedRow({ owner: 'u', username: '<b>x</b>', avatar: '💩', id: 'a', done_at: 5, s: { date: 5 }, bravos: 3, my_bravo: true })`);
    assert.equal(row.username, null, 'pseudo hors de la forme du serveur : ignoré (initiale)');
    assert.equal(row.avatar, null, 'avatar hors liste blanche : initiale');
    assert.equal(row.bravos, 3);
  });

  test('amis : état social_state nettoyé, badge et relation', () => {
    const st = run(`cleanSocialState({ enabled: true, pending_in: [{ user_id: 'a', username: 'lea' }, { username: 'sans_id' }], following: [{ user_id: 'b', username: 'tom' }], followers: [{ user_id: 'a', username: 'lea' }], badge: 1 })`);
    assert.equal(st.pending_in.length, 1);
    assert.equal(st.badge, 1);
    sameJSON(st.blocked, []);
    const rel = run(`(() => { const st = ${JSON.stringify(st)};
      return [socialRelation('a', st), socialRelation('b', st), socialRelation('c', st)].map(r => [r.status, r.followsYou, r.pendingIn]); })()`);
    sameJSON(rel, [['none', true, true], ['following', false, false], ['none', false, false]]);
  });

  test('amis : recherche normalisée comme le serveur, 2 caractères au moins', () => {
    assert.equal(run(`normalizeSocialQuery(' @Hélène ')`), 'helene');
    assert.equal(run(`normalizeSocialQuery('@a')`), '');
    assert.equal(run(`normalizeSocialQuery('max.dlf!')`), 'max.dlf');
  });

  test('amis : erreurs du serveur traduites en français', () => {
    const kinds = run(`[{ code: 'P0001', message: 'social_not_enabled' }, { message: 'username_required' }, { message: 'age_required' },
      { message: 'rate_limited' }, { message: 'not_found' }, { message: 'TypeError: Failed to fetch' }, { message: 'boom' }].map(socialErrorKind)`);
    sameJSON(kinds, ['social_not_enabled', 'username_required', 'age_required', 'rate_limited', 'not_found', 'offline', 'server']);
    for (const k of kinds) assert.match(run(`socialErrorText(${JSON.stringify(k)})`), /^[A-ZÉ].+\.$/, k);
  });

  test('amis : « Séances visibles par défaut » éteint → la séance qui se termine naît masquée (hidden: true)', () => {
    const r = run(`(() => {
      const user = account.user, saved = { ...social }, act = activeSession;
      globalThis.sessionNotes ??= '';
      try {
        data = makeDefaultData(); data.schema = SCHEMA;
        activeSession = { category: 'push', programme: 'ppl', startedAt: Date.now() - 60000,
          exercises: [{ exId: 'a', name: 'A', sets: [{ weight: '10', reps: '8', done: true }] }] };
        const out = {};
        out.def = sessionsVisibleByDefault();                       // réglage absent : visible
        out.offNoFriends = (data.sessionVisibleDefault = false, newSessionHidden());   // Amis pas activé : rien à masquer
        account.user = { id: 'u' }; social.state = cleanSocialState({ enabled: true });
        out.offFriends = newSessionHidden();
        out.entryOff = sessionHistoryEntry('ppl', 'push').hidden;
        data.sessionVisibleDefault = true;
        out.entryOn = 'hidden' in sessionHistoryEntry('ppl', 'push');
        return out;
      } finally { account.user = user; Object.assign(social, saved); activeSession = act; data = makeDefaultData(); data.schema = SCHEMA; }
    })()`);
    sameJSON(r, { def: true, offNoFriends: false, offFriends: true, entryOff: true, entryOn: false });
  });

  test('amis : résumé des exercices d\'une carte', () => {
    const line = names => run(`feedExercisesLine({ exercises: ${JSON.stringify(names.map(name => ({ name })))} })`);
    assert.equal(line(['A']), 'A');
    assert.equal(line(['A', 'B']), 'A et B');
    assert.equal(line(['A', 'B', 'C', 'D']), 'A, B, C et D');
    assert.equal(line(['A', 'B', 'C', 'D', 'E']), 'A, B, C et 2 autres');
  });

  test('amis : « Masquer à mes abonnés » gardé par le nettoyage seulement s\'il vaut true', () => {
    const r = run(`[true, false, 'oui'].map(v => { const h = { id: 'a', date: 1, category: 'push', exercises: [], hidden: v }; cleanHistoryEntry(h); return 'hidden' in h ? h.hidden : null; })`);
    sameJSON(r, [true, null, null]);
  });
  test('amis : fil jamais chargé relancé d\'office une fois par lecture de l\'état (hors ligne puis réseau, onglet ouvert pendant la lecture)', () => {
    const r = run(`(() => {
      const user = account.user, saved = { ...social };
      try {
        account.user = { id: 'u' };
        Object.assign(social, { userId: 'u', state: null, cached: null, loadedAt: 0, feeds: {} });
        const out = [];
        out.push(socialFeedNeedsLoad(''));                        // état pas encore lu : Amis activé inconnu
        social.state = cleanSocialState({ enabled: true }); social.loadedAt = 1000;
        out.push(socialFeedNeedsLoad(''));                        // état lu pendant que l'onglet était ouvert
        const f = socialFeed(''); f.loading = true; f.triedAt = 1000;
        out.push(socialFeedNeedsLoad(''));                        // en cours
        f.loading = false; f.error = 'offline';
        out.push(socialFeedNeedsLoad(''));                        // échec avec cet état : pas de boucle
        social.loadedAt = 2000;
        out.push(socialFeedNeedsLoad(''));                        // réseau revenu, état relu : nouvel essai
        f.error = null; f.loadedAt = 2100;
        out.push(socialFeedNeedsLoad(''));                        // chargé : rien
        social.state = cleanSocialState({ enabled: false });
        out.push(socialFeedNeedsLoad('autre'));                   // Amis désactivé : rien
        return out;
      } finally { account.user = user; Object.assign(social, saved); }
    })()`);
    assert.deepEqual([...r], [false, true, false, false, true, false, false]);
  });

  test('réactions : liste fermée, comptes nettoyés, la plus fréquente, résumé et VoiceOver', () => {
    sameJSON(run(`REACTIONS.map(r => r.kind)`), ['clap', 'fire', 'strong', 'trophy', 'wow']);
    sameJSON(run(`cleanReactionCounts({ clap: 2, fire: 0, heart: 4, wow: 1.5, strong: -1, trophy: '3' })`), { clap: 2 }, 'sortes connues et entiers positifs seulement');
    sameJSON(run(`reactionsTop({ fire: 1, clap: 1, wow: 3 })`), ['wow', 'clap', 'fire'], 'égalité : ordre de la liste, comme le serveur');
    assert.equal(run(`reactionsSummary({ fire: 2, clap: 1 })`), '🔥👏 3');
    assert.equal(run(`reactionsSummary({})`), '');
    assert.equal(run(`reactionsSpoken({ fire: 2, clap: 1 })`), '3 réactions : 2 Chaud, 1 Applaudissements');
    // Ma réaction changée, retirée, posée : les comptes suivent, l'objet d'entrée ne bouge pas
    sameJSON(run(`(() => { const c = { fire: 1, clap: 2 }; const out = [withMyReaction(c, 'fire', 'clap'), withMyReaction(c, 'clap', null), withMyReaction(c, null, 'wow'), c]; return out; })()`),
      [{ clap: 3 }, { fire: 1, clap: 1 }, { fire: 1, clap: 2, wow: 1 }, { fire: 1, clap: 2 }]);
    // Un toucher : 👏, ou retirer la mienne (quelle qu'elle soit)
    sameJSON(run(`[tapReaction(null), tapReaction('fire'), tapReaction('clap')]`), ['clap', null, null]);
  });

  test('réactions : ligne du fil avec réactions, et serveur d\'avant (bravos seulement) compté en 👏', () => {
    const row = run(`cleanFeedRow({ owner: 'u', id: 'a', done_at: 5, s: {}, bravos: 3, my_bravo: true, reactions: { fire: 2, clap: 1, x: 9 }, my_reaction: 'fire' })`);
    sameJSON([row.reactions, row.my, row.bravos, row.mine], [{ clap: 1, fire: 2 }, 'fire', 3, true]);
    const old = run(`cleanFeedRow({ owner: 'u', id: 'a', done_at: 5, s: {}, bravos: 2, my_bravo: true })`);
    sameJSON([old.reactions, old.my], [{ clap: 2 }, 'clap']);
    const none = run(`cleanFeedRow({ owner: 'u', id: 'a', done_at: 5, s: {}, bravos: 0, my_bravo: false, reactions: {}, my_reaction: 'heart' })`);
    sameJSON([none.reactions, none.my, none.mine], [{}, null, false], 'réaction inconnue : ignorée');
  });

  test('réactions : qui a réagi et activité nettoyés, textes de l\'activité', () => {
    const who = run(`[{ user_id: 'b', username: 'cyril', avatar: '🦊', kind: 'fire', at: '2026-10-30T10:00:00Z' }, { user_id: 'c', kind: 'heart' }, { kind: 'clap' }].map(cleanWhoRow)`);
    assert.equal(who[0].kind, 'fire');
    assert.equal(who[0].at, Date.parse('2026-10-30T10:00:00Z'));
    assert.equal(who[1], null, 'réaction hors liste');
    assert.equal(who[2], null, 'sans identifiant');
    const rows = run(`[
      { kind: 'reaction', user_id: 'b', username: 'cyril', at: '2026-10-30T10:00:00Z', reaction: 'fire', session_id: 's1', session_label: 'Legs', session_at: 5, is_new: true },
      { kind: 'follower', user_id: 'c', username: 'paul', at: '2026-10-29T10:00:00Z' },
      { kind: 'accepted', user_id: 'd', username: 'lea', at: '2026-10-29T10:00:00Z' },
      { kind: 'request', user_id: 'e', username: 'tom', at: '2026-10-29T10:00:00Z' },
      { kind: 'reaction', user_id: 'b', at: '2026-10-30T10:00:00Z', reaction: 'heart', session_id: 's1' },
      { kind: 'like', user_id: 'b', at: '2026-10-30T10:00:00Z' },
      { kind: 'follower', user_id: 'b', at: 'pas une date' },
    ].map(cleanActivityRow)`);
    assert.equal(rows.filter(Boolean).length, 4, 'réaction inconnue, sorte inconnue, date illisible : écartées');
    assert.equal(rows[0].isNew, true);
    assert.equal(rows[1].isNew, false);
    sameJSON(run(`${JSON.stringify(rows.slice(0, 4))}.map(r => activityText(r))`),
      ['a réagi 🔥 à ta séance Legs', 'a commencé à te suivre', 'a accepté ta demande', 'veut voir tes séances']);
    assert.equal(run(`activityText(${JSON.stringify(rows[0])}, 'Jambes A')`), 'a réagi 🔥 à ta séance Jambes A', 'nom de cet appareil d\'abord');
  });

  test('réactions : page suivante de Mon profil avec le curseur exact du serveur (microsecondes, clé de départage)', async () => {
    const args = await run(`(async () => {
      const user = account.user, savedSb = sb, saved = social.activity, calls = [];
      try {
        account.user = { id: 'u' }; social.activity = null;
        // 50 lignes à la même date (microsecondes que Date.parse perdrait) : la page est pleine
        const at = '2026-10-30T10:00:00.123456+00:00';
        sb = { rpc: async (fn, a) => { calls.push(a ?? null);
          return { data: Array.from({ length: 50 }, (_, i) => ({ kind: i % 2 ? 'follower' : 'reaction', user_id: 'b' + i, username: 'p' + i, at,
            reaction: 'fire', session_id: 's' + i })), error: null }; } };
        await socialLoadActivity();
        await socialLoadActivity({ more: true });
        return calls;
      } finally { account.user = user; sb = savedSb; social.activity = saved; }
    })()`);
    sameJSON(args[0], {}, 'première page : sans curseur');
    sameJSON(args[1], { before_at: '2026-10-30T10:00:00.123456+00:00', before_key: 'follower:b49:' },
      'date telle que reçue et clé kind:user_id:session_id (vide hors réaction)');
    assert.equal(run(`cleanActivityRow({ kind: 'reaction', user_id: 'b', at: '2026-10-30T10:00:00Z', reaction: 'fire', session_id: 's1' }).cursor.key`), 'reaction:b:s1');
  });

  test('réactions : « il y a » de l\'activité', () => {
    const now = Date.parse('2026-10-30T12:00:00Z');
    sameJSON(run(`[30e3, 5 * 60e3, 2 * 3600e3, 26 * 3600e3, 3 * 86400e3].map(d => fmtAgo(${now} - d, ${now}))`),
      ['à l\'instant', 'il y a 5 min', 'il y a 2 h', 'hier', 'il y a 3 j']);
    assert.equal(run(`fmtAgo(${now} - 20 * 86400e3, ${now}) === fmtDate(${now} - 20 * 86400e3)`), true, 'au-delà d\'une semaine : la date');
    assert.equal(run(`fmtAgo(${now} + 60e3, ${now})`), 'à l\'instant', 'horloge en retard : jamais « dans »');
  });

  test('réactions : pastille = demandes reçues + nouveautés, gardée sur l\'appareil, éteinte à l\'ouverture', () => {
    const r = run(`(() => {
      const user = account.user, saved = { ...social };
      try {
        account.user = { id: 'u' }; social.userId = 'u';
        social.state = cleanSocialState({ enabled: true, badge: 1, activity_new: 2, shown_sessions: 7 });
        const out = { badge: socialBadge(), pending: socialPending(), shown: social.state.shown_sessions };
        writeSocialCache();
        out.cache = readSocialCache('u');
        social.state = null; social.cached = out.cache;
        out.cachedBadge = socialBadge();
        out.oldServer = cleanSocialState({ enabled: true, badge: 1 });
        return out;
      } finally { account.user = user; Object.assign(social, saved); try { localStorage.removeItem(SOCIAL_CACHE_KEY); } catch {} }
    })()`);
    sameJSON([r.badge, r.pending, r.shown, r.cache, r.cachedBadge], [3, 1, 7, { enabled: true, badge: 1, activityNew: 2 }, 3]);
    sameJSON([r.oldServer.activity_new, r.oldServer.shown_sessions], [0, null], 'serveur d\'avant : pas de pastille, chiffre inconnu');
  });
}
