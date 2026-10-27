// Coach (js/data/coach.js) : logique pure sans réseau (nettoyage de ce que renvoie le serveur, format
// d'envoi d'un programme, import et mise à jour d'un programme reçu, conflits, champs gardés par
// sanitizeData et la synchro)
export default function ({ test, run, reset, assert, sameJSON }) {
  const DAY = 86400000;

  test('coach : coach_state nettoyé (personnes, élèves, codes, badge, nouvelles séances)', () => {
    const st = run(`cleanCoachState({ is_coach: true, coach: null, badge: 3,
      students: [{ user_id: 'a', username: 'lea', avatar: '🦊', since: '2026-10-01', sessions_7d: 2, new_sessions: 3,
        last_session: { done_at: 1000, label: 'Push', programme: 'u_cppl' } },
        { user_id: 'b', username: '<b>x</b>', sessions_7d: -1, new_sessions: 'x' }, { username: 'sans_id' }],
      invites: [{ code: 'K7M2QX9P', expires_at: '2026-11-01T00:00:00Z' }, { code: 'ABC', expires_at: 'x' }, { code: 'O0O0O0O0', expires_at: 1 }] })`);
    assert.equal(st.students.length, 2);
    sameJSON(st.students[0].last_session, { done_at: 1000, label: 'Push', programme: 'u_cppl' });
    assert.equal(st.students[0].new_sessions, 3);
    assert.equal(st.students[1].username, null, 'pseudo hors forme : ignoré');
    assert.equal(st.students[1].sessions_7d, 0);
    assert.equal(st.students[1].last_session, null);
    sameJSON(st.invites.map(i => i.code), ['K7M2QX9P'], 'codes hors alphabet (0, O) écartés');
    assert.equal(st.badge, 3);
    // Badge absent : somme des nouvelles séances côté coach ; élève sans rôle coach : pas d'élèves
    assert.equal(run(`cleanCoachState({ is_coach: true, students: [{ user_id: 'a', new_sessions: 2 }, { user_id: 'b', new_sessions: 1 }] }).badge`), 3);
    const el = run(`cleanCoachState({ is_coach: false, coach: { user_id: 'c', username: 'max' }, students: [{ user_id: 'a' }], invites: [{ code: 'K7M2QX9P', expires_at: 1 }] })`);
    assert.equal(el.coach.username, 'max');
    sameJSON([el.students.length, el.invites.length, el.badge], [0, 0, 0]);
    assert.equal(run(`cleanCoachState(null).is_coach`), false);
  });

  test('coach : séance d\'un élève réduite à sa liste blanche (notes et hidden en plus)', () => {
    const r = run(`cleanCoachSessionRow({ id: 's1', done_at: 5, note: 'Bien', s: { date: 5, label: 'Push', notes: 'dur', hidden: true, bodyKg: 80, healthSaved: true,
      exercises: [{ name: 'DC', sets: [{ weight: 80, reps: 8 }] }] } })`);
    sameJSON(Object.keys(r.s).sort(), ['category', 'date', 'duration', 'exercises', 'hidden', 'label', 'notes', 'programme']);
    assert.equal(r.s.notes, 'dur');
    assert.equal(r.s.hidden, true);
    assert.equal(r.note, 'Bien');
    assert.equal(run(`cleanCoachSessionRow({ id: '', s: {} })`), null);
    assert.equal(run(`cleanCoachSessionRow({ id: 'x', s: {} })`), null, 'sans date : écartée');
  });

  test('coach : programme reçu validé (bornes, clés de séance, supersets, consignes de 500 caractères)', () => {
    const p = run(`cleanSentProgramme({ name: '  Force  ', consigne: '  3 fois par semaine  ', extra: 1, sessions: [
      { key: 'push', label: 'Push', color: '#FF9500', exercises: [
        { name: 'DC', sets: 4, rest: 120, tempo: '3-1-1', repMax: 8, ss: 'a1', consigne: 'x'.repeat(900), weight: 80 },
        { name: 'Dips', sets: 99, rest: 5, measure: 'nage', ss: 'a1' },
        { name: 'Seul', sets: 3, ss: 'zz' }, { name: '' }, null] },
      { key: 'push', label: '', color: 'red', exercises: [] },
      { key: '<b>', label: 'L', exercises: 'x' }] })`);
    assert.equal(p.name, 'Force');
    assert.equal(p.consigne, '3 fois par semaine');
    assert.equal(p.extra, undefined);
    sameJSON(p.sessions.map(s => s.key), ['push', 'pushb', 's2'], 'clés uniques et sûres');
    const [dc, dips, seul] = p.sessions[0].exercises;
    sameJSON(Object.keys(dc).sort(), ['consigne', 'name', 'repMax', 'rest', 'sets', 'ss', 'tempo']);
    assert.equal(dc.consigne.length, 500);
    assert.equal(dc.tempo, '3-1-1-0');
    assert.equal(dips.sets, 3, 'séries hors bornes : 3');
    assert.equal(dips.rest, undefined);
    assert.equal(dips.measure, undefined);
    assert.equal(dips.ss, 'a1', 'superset de deux gardé');
    assert.equal(seul.ss, undefined, 'superset isolé effacé');
    assert.equal(p.sessions[1].label, 'Séance');
    assert.equal(p.sessions[1].color, '#8E8E93');
    assert.equal(run(`cleanSentProgramme({ sessions: [] })`), null, 'sans nom : refusé');
    assert.equal(run(`cleanSentProgramme([1])`), null);
  });

  test('coach : boîte de réception, code d\'invitation, erreurs traduites', () => {
    const ib = run(`cleanInbox({ programmes: [{ id: 'ppl', data: { name: 'A', sessions: [] }, sent_at: '2026-10-02T00:00:00Z', seen: false },
      { id: '../x', data: { name: 'B' } }, { id: 'u_1', data: null }, { id: 'u_2', data: { name: 'C', sessions: [] }, sent_at: '2026-10-03T00:00:00Z', seen: true }],
      notes: [{ session_id: 's1', text: '  Bravo  ', updated_at: 1, seen: false }, { session_id: 's2', text: '' }, { text: 'x' }] })`);
    sameJSON(ib.programmes.map(p => p.id), ['u_2', 'ppl'], 'triés du plus récent, identifiants sûrs');
    sameJSON(ib.notes, [{ session_id: 's1', text: 'Bravo', updatedAt: 1, seen: false }]);
    assert.equal(run(`normalizeCoachCode(' k7m2-qx9p ')`), 'K7M2QX9P');
    assert.equal(run(`normalizeCoachCode('K7M2QX9')`), null);
    assert.equal(run(`normalizeCoachCode('K7M2QX0P')`), null, '0 exclu');
    const kinds = run(`['not_coach', 'already_coached', 'invalid_code', 'team_full', 'not_found', 'rate_limited', 'too_long', 'TypeError: Failed to fetch', 'boom']
      .map(m => coachErrorKind({ code: 'P0001', message: m }))`);
    sameJSON(kinds, ['not_coach', 'already_coached', 'invalid_code', 'team_full', 'not_found', 'rate_limited', 'too_long', 'offline', 'server']);
    for (const k of [...kinds, 'too_big', 'signed_out']) assert.match(run(`coachErrorText(${JSON.stringify(k)})`), /^[A-ZÉ].+\.$/, k);
    for (const k of kinds) assert.ok(!/ - | – /.test(run(`coachErrorText(${JSON.stringify(k)})`)), `${k} : sans tiret`);
  });

  // Programme du coach : perso, deux séances, superset et tempo
  const seedCoachProg = () => run(`
    data.userProgrammes.u_force = { name: 'Force', archived: false, consigne: 'Progresse doucement', sessions: {
      sA: { label: 'Haut', icon: '', desc: '', color: '#FF9500' }, sB: { label: 'Bas', icon: '', desc: '', color: '#34C759' } } };
    data.programmes.u_force = { timers: {}, cooldowns: {}, exercises: {
      sA: [{ id: 'e1', name: 'Développé couché', sets: 4, rest: 120, tempo: '3-1-1-0', ss: 'g1', consigne: 'Coudes serrés', lastWeight: '80', pr: { weight: '80', reps: '8' } },
           { id: 'e2', name: 'Rowing', sets: 4, ss: 'g1' }],
      sB: [{ id: 'e3', name: 'Squat', sets: 5, repMax: 5, measure: 'reps' }] } };
    data.myProgrammes.push('u_force');`);

  test('coach : programme converti au format d\'envoi, consignes saisies et taille', () => {
    reset();
    seedCoachProg();
    const p = run(`programmeToSent(data, 'u_force')`);
    assert.equal(p.name, 'Force');
    assert.equal(p.consigne, 'Progresse doucement');
    sameJSON(p.sessions.map(s => [s.key, s.label, s.color]), [['sA', 'Haut', '#FF9500'], ['sB', 'Bas', '#34C759']]);
    sameJSON(p.sessions[0].exercises[0], { name: 'Développé couché', sets: 4, rest: 120, tempo: '3-1-1-0', ss: 'g1', consigne: 'Coudes serrés' });
    assert.equal(JSON.stringify(p).includes('80'), false, 'ni charges ni records');
    // Consignes saisies à l'envoi : elles priment, vide = retirée
    const q = run(`programmeToSent(data, 'u_force', { prog: '', ex: { sA: { e1: '', e2: 'Dos droit' } } })`);
    assert.equal(q.consigne, undefined);
    assert.equal(q.sessions[0].exercises[0].consigne, undefined);
    assert.equal(q.sessions[0].exercises[1].consigne, 'Dos droit');
    // Programme intégré : séances de PROGRAMMES
    const ppl = run(`programmeToSent(data, 'ppl')`);
    sameJSON(ppl.sessions.map(s => s.key), ['push', 'pull', 'legs']);
    assert.ok(ppl.sessions[0].exercises.length > 0);
    assert.ok(run(`sentProgrammeBytes(programmeToSent(data, 'u_force'))`) < 200 * 1024);
    sameJSON(run(`cleanSentProgramme(programmeToSent(data, 'u_force'))`), p, 'aller-retour sans perte');
  });

  // Élève : reçoit le programme du coach (contexte vierge, envoi simulé)
  const inboxItem = (sentAt, mutate = '') => run(`(() => { const p = programmeToSent(data, 'u_force'); ${mutate}; return { id: 'u_force', data: cleanSentProgramme(p), sentAt: ${sentAt}, seen: false }; })()`);

  test('coach : import d\'un programme reçu (u_c<id>, fromCoach, consignes, supersets)', () => {
    reset();
    seedCoachProg();
    const item = inboxItem(1000);
    reset();
    const st0 = run(`coachProgrammeStatus(data, ${JSON.stringify(item)})`);
    assert.equal(st0.status, 'new');
    const id = run(`importCoachProgramme(data, ${JSON.stringify(item)}, { user_id: 'c1', username: 'max' })`);
    assert.equal(id, 'u_cu_force');
    const up = run('data.userProgrammes.u_cu_force');
    sameJSON({ ...up.fromCoach, hash: !!up.fromCoach.hash }, { coachId: 'c1', name: 'max', sentAt: 1000, hash: true });
    assert.equal(up.consigne, 'Progresse doucement');
    sameJSON(Object.keys(up.sessions), ['sA', 'sB']);
    const xs = run('data.programmes.u_cu_force.exercises.sA');
    sameJSON(xs.map(x => [x.name, x.sets, x.ss, x.consigne || null]), [['Développé couché', 4, 'g1', 'Coudes serrés'], ['Rowing', 4, 'g1', null]]);
    assert.equal(xs[0].lastWeight, '', 'aucune charge du coach');
    assert.ok(run('data.myProgrammes.includes("u_cu_force")'), 'ajouté à Mes programmes');
    assert.equal(run('data.programmes.u_cu_force.cooldowns.sA'), 72);
    sameJSON(run(`coachProgrammeStatus(data, ${JSON.stringify(item)})`), { status: 'current', modified: false });
    // Gardé par sanitizeData (et normalizeData) puis par la synchro du profil
    run('save(); data = loadData();');
    assert.equal(run('data.userProgrammes.u_cu_force.fromCoach.name'), 'max');
    assert.equal(run('data.programmes.u_cu_force.exercises.sA[0].consigne'), 'Coudes serrés');
    assert.equal(run('data.userProgrammes.u_cu_force.consigne'), 'Progresse doucement');
    sameJSON(run(`coachProgrammeStatus(data, ${JSON.stringify(item)})`), { status: 'current', modified: false }, 'empreinte stable après rechargement');
    const prof = run('profilePayload(data)');
    assert.equal(prof.userProgrammes.u_cu_force.fromCoach.coachId, 'c1');
    assert.equal(prof.programmes.u_cu_force.exercises.sA[0].consigne, 'Coudes serrés');
    // Reçu sur un autre appareil vierge : fromCoach et consignes arrivent
    const other = run(`(() => { const d = makeDefaultData(); applyRemoteProfile(d, { doc: profilePayload(data), updated_at: 'z' }, emptySyncMeta('u')); sanitizeData(d); return d; })()`);
    assert.equal(other.userProgrammes.u_cu_force.fromCoach.sentAt, 1000);
    assert.equal(other.programmes.u_cu_force.exercises.sA[0].consigne, 'Coudes serrés');
  });

  test('coach : mise à jour d\'un programme reçu, identifiants gardés pour l\'historique', () => {
    reset();
    seedCoachProg();
    const v1 = inboxItem(1000);
    // v2 : séries changées, Rowing retiré, nouvel exercice, consigne retirée, séance Bas renommée
    const v2 = inboxItem(2000, `p.sessions[0].exercises[0].sets = 5; delete p.sessions[0].exercises[0].consigne; delete p.sessions[0].exercises[0].tempo;
      p.sessions[0].exercises.splice(1, 1, { name: 'Tractions', sets: 3 }); p.sessions[1].label = 'Jambes'`);
    reset();
    run(`importCoachProgramme(data, ${JSON.stringify(v1)}, { user_id: 'c1', username: 'max' })`);
    const before = run('data.programmes.u_cu_force.exercises.sA.map(x => x.id)');
    run(`data.programmes.u_cu_force.exercises.sA[0].tempoGuide = true; data.programmes.u_cu_force.exercises.sA[0].muscles = ['chest'];
      data.history.push({ id: 'h1', programme: 'u_cu_force', category: 'sA', date: Date.now() - ${DAY}, exercises: [{ exId: '${before[0]}', name: 'Développé couché', sets: [{ weight: '70', reps: '8' }] }] });`);
    sameJSON(run(`coachProgrammeStatus(data, ${JSON.stringify(v2)})`), { status: 'update', modified: false });
    run(`importCoachProgramme(data, ${JSON.stringify(v2)}, null)`);
    const xs = run('data.programmes.u_cu_force.exercises.sA');
    assert.equal(xs[0].id, before[0], 'même nom : même identifiant');
    assert.equal(xs[0].sets, 5);
    assert.equal(xs[0].consigne, undefined, 'consigne retirée par le coach');
    assert.equal(xs[0].tempo, undefined);
    assert.equal(xs[0].tempoGuide, undefined, 'guidage retiré avec le tempo');
    sameJSON(xs[0].muscles, ['chest'], 'réglage de l\'élève gardé');
    assert.equal(xs[0].ss, undefined, 'superset défait (Rowing retiré)');
    assert.notEqual(xs[1].id, before[1]);
    assert.equal(xs[1].name, 'Tractions');
    assert.equal(run('data.userProgrammes.u_cu_force.sessions.sB.label'), 'Jambes');
    assert.equal(run('data.userProgrammes.u_cu_force.fromCoach.name'), 'max', 'coach gardé si non fourni');
    assert.equal(run('data.userProgrammes.u_cu_force.fromCoach.sentAt'), 2000);
    run('recomputePRFromHistory()');
    sameJSON(run('data.programmes.u_cu_force.exercises.sA[0].pr'), { weight: '70', reps: '8' }, 'records relus de l\'historique');
  });

  test('coach : programme modifié par l\'élève, conflit et « Garder ma version »', () => {
    reset();
    seedCoachProg();
    const v1 = inboxItem(1000), v2 = inboxItem(2000, 'p.sessions[0].exercises[0].sets = 6'), v3 = inboxItem(3000);
    reset();
    run(`importCoachProgramme(data, ${JSON.stringify(v1)}, { user_id: 'c1', username: 'max' })`);
    run('data.programmes.u_cu_force.exercises.sB[0].sets = 3;');   // l'élève change ses séries
    sameJSON(run(`coachProgrammeStatus(data, ${JSON.stringify(v1)})`), { status: 'current', modified: true });
    sameJSON(run(`coachProgrammeStatus(data, ${JSON.stringify(v2)})`), { status: 'update', modified: true }, 'nouvel envoi : la question sera posée');
    run(`keepMyCoachProgramme(data, ${JSON.stringify(v2)})`);
    assert.equal(run(`coachProgrammeStatus(data, ${JSON.stringify(v2)}).status`), 'current', 'version refusée : plus proposée');
    assert.equal(run('data.programmes.u_cu_force.exercises.sB[0].sets'), 3, 'version de l\'élève intacte');
    assert.equal(run(`coachProgrammeStatus(data, ${JSON.stringify(v3)}).status`), 'update', 'envoi suivant de nouveau proposé');
    // Supprimé par l'élève (archivé) : de nouveau « nouveau », l'import le ramène avec le même identifiant
    run('data.userProgrammes.u_cu_force.archived = true;');
    assert.equal(run(`coachProgrammeStatus(data, ${JSON.stringify(v3)}).status`), 'new');
    assert.equal(run(`importCoachProgramme(data, ${JSON.stringify(v3)}, null)`), 'u_cu_force');
    assert.equal(run('data.userProgrammes.u_cu_force.archived'), false);
  });

  test('coach : champs du coach bornés par sanitizeData', () => {
    const d = run(`sanitizeData({ programmes: { u_cx: { exercises: { s: [{ name: 'A', sets: 3, consigne: 42 }, { name: 'B', sets: 3, consigne: '  ok  ' }, { name: 'C', sets: 3, consigne: '   ' }] } } },
      userProgrammes: { u_cx: { name: 'X', sessions: {}, consigne: 'x'.repeat(800), fromCoach: { coachId: 'c', name: '<b>', sentAt: 'x', hash: 'h', keptAt: 5, evil: 1 } },
        u_cy: { name: 'Y', sessions: {}, fromCoach: 'oui' } }, history: [] })`);
    sameJSON(d.programmes.u_cx.exercises.s.map(x => x.consigne ?? null), [null, 'ok', null]);
    assert.equal(d.userProgrammes.u_cx.consigne.length, 500);
    sameJSON(d.userProgrammes.u_cx.fromCoach, { coachId: 'c', name: null, sentAt: 0, hash: 'h', keptAt: 5 });
    assert.equal(d.userProgrammes.u_cy.fromCoach, undefined);
  });

  test('coach : séances faites avec mon programme reconnues (u_c<prog_id>)', () => {
    reset();
    seedCoachProg();
    assert.equal(run(`coachOwnProgrammeName('u_cu_force')`), 'Force');
    assert.equal(run(`coachOwnProgrammeName('u_cppl')`), run('PROGRAMMES.ppl.name'));
    assert.equal(run(`coachOwnProgrammeName('u_cinconnu')`), null, 'pas un de mes programmes');
    assert.equal(run(`coachOwnProgrammeName('ppl')`), null);
    assert.equal(run(`coachOwnProgrammeName('u_ccustom')`), null);
    assert.equal(run(`coachSentIdOf('u_cu_force')`), 'u_force');
    assert.equal(run(`coachLocalId('ppl')`), 'u_cppl');
  });

  test('coach : badge et rôle gardés sur l\'appareil, badge de l\'onglet = social + coach', () => {
    const r = run(`(() => {
      const user = account.user, saved = { ...coach };
      try {
        account.user = { id: 'u' };
        localStorage.setItem(COACH_CACHE_KEY, JSON.stringify({ userId: 'u', isCoach: true, hasCoach: false, badge: 4 }));
        coachReset('u');
        const out = [coachRole().isCoach, coachBadge()];
        coach.state = cleanCoachState({ is_coach: false, coach: { user_id: 'c', username: 'max' }, badge: 2 });
        out.push(coachRole().hasCoach, coachBadge());
        coachReset('autre');
        out.push(coach.cached);
        account.user = null;
        out.push(coachBadge());
        return out;
      } finally { account.user = user; Object.assign(coach, saved); }
    })()`);
    sameJSON(r, [true, 4, true, 2, null, 0]);
  });
}
