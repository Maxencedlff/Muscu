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
    const el = run(`cleanCoachState({ is_coach: false, coach: { user_id: 'c1', username: 'max' }, students: [{ user_id: 'a' }], invites: [{ code: 'K7M2QX9P', expires_at: 1 }] })`);
    assert.equal(el.coach.username, 'max');
    sameJSON([el.students.length, el.invites.length, el.badge], [0, 0, 0]);
    assert.equal(run(`cleanCoachState(null).is_coach`), false);
    // Badges séparés du serveur : badge_coach (Mes élèves), badge_student (Mon coach), badge = leur somme
    const both = run(`cleanCoachState({ is_coach: true, coach: { user_id: 'c1', username: 'max' }, students: [{ user_id: 'a', new_sessions: 2 }], badge_coach: 2, badge_student: 3, badge: 5 })`);
    sameJSON([both.badge_coach, both.badge_student, both.badge], [2, 3, 5]);
    const old = run(`cleanCoachState({ is_coach: false, coach: { user_id: 'c1', username: 'max' }, badge: 4 })`);
    sameJSON([old.badge_coach, old.badge_student, old.badge], [0, 4, 4], 'sans les badges séparés : badge de l\'élève déduit');
    assert.equal(run(`cleanCoachState({ is_coach: false, coach: null, badge_student: 3 }).badge`), 0, 'sans coach : rien côté élève');
  });

  test('coach : séance d\'un élève réduite à sa liste blanche (notes et hidden en plus)', () => {
    const r = run(`cleanCoachSessionRow({ id: 's1', done_at: 5, note: 'Bien', s: { date: 5, label: 'Push', notes: 'dur', hidden: true, bodyKg: 80, healthSaved: true,
      exercises: [{ name: 'DC', sets: [{ weight: 80, reps: 8 }] }] } })`);
    // bodyKg : le serveur ne l'envoie que si l'élève partage son poids avec ce coach (20261031300000_partage_coach.sql)
    sameJSON(Object.keys(r.s).sort(), ['bodyKg', 'category', 'date', 'duration', 'exercises', 'hidden', 'label', 'notes', 'programme']);
    assert.equal(r.s.bodyKg, 80);
    for (const bad of ['"80"', '10', '400', 'null', '{}']) {
      assert.equal(run(`cleanCoachSessionRow({ id: 's1', done_at: 5, s: { date: 5, bodyKg: ${bad} } })`).s.bodyKg, undefined, `bodyKg ${bad} écarté`);
    }
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
    sameJSON(run(`['invalid_programme', 'username_required'].map(m => coachErrorKind({ message: m }))`), ['invalid_programme', 'username_required']);
    for (const k of ['invalid_programme', 'username_required']) assert.match(run(`coachErrorText(${JSON.stringify(k)})`), /^[A-ZÉ].+\.$/, k);
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
    const st0 = run(`coachProgrammeStatus(data, ${JSON.stringify(item)}, 'c1')`);
    assert.equal(st0.status, 'new');
    const id = run(`importCoachProgramme(data, ${JSON.stringify(item)}, { user_id: 'c1', username: 'max' })`);
    assert.equal(id, 'u_cc1_u_force');
    const up = run('data.userProgrammes.u_cc1_u_force');
    sameJSON({ ...up.fromCoach, hash: !!up.fromCoach.hash }, { coachId: 'c1', name: 'max', sentAt: 1000, hash: true });
    assert.equal(up.consigne, 'Progresse doucement');
    sameJSON(Object.keys(up.sessions), ['sA', 'sB']);
    const xs = run('data.programmes.u_cc1_u_force.exercises.sA');
    sameJSON(xs.map(x => [x.name, x.sets, x.ss, x.consigne || null]), [['Développé couché', 4, 'g1', 'Coudes serrés'], ['Rowing', 4, 'g1', null]]);
    assert.equal(xs[0].lastWeight, '', 'aucune charge du coach');
    assert.ok(run('data.myProgrammes.includes("u_cc1_u_force")'), 'ajouté à Mes programmes');
    assert.equal(run('data.programmes.u_cc1_u_force.cooldowns.sA'), 72);
    sameJSON(run(`(({ status, modified }) => ({ status, modified }))(coachProgrammeStatus(data, ${JSON.stringify(item)}, 'c1'))`), { status: 'current', modified: false });
    // Gardé par sanitizeData (et normalizeData) puis par la synchro du profil
    run('save(); data = loadData();');
    assert.equal(run('data.userProgrammes.u_cc1_u_force.fromCoach.name'), 'max');
    assert.equal(run('data.programmes.u_cc1_u_force.exercises.sA[0].consigne'), 'Coudes serrés');
    assert.equal(run('data.userProgrammes.u_cc1_u_force.consigne'), 'Progresse doucement');
    sameJSON(run(`(({ status, modified }) => ({ status, modified }))(coachProgrammeStatus(data, ${JSON.stringify(item)}, 'c1'))`), { status: 'current', modified: false }, 'empreinte stable après rechargement');
    const prof = run('profilePayload(data)');
    assert.equal(prof.userProgrammes.u_cc1_u_force.fromCoach.coachId, 'c1');
    assert.equal(prof.programmes.u_cc1_u_force.exercises.sA[0].consigne, 'Coudes serrés');
    // Reçu sur un autre appareil vierge : fromCoach et consignes arrivent
    const other = run(`(() => { const d = makeDefaultData(); applyRemoteProfile(d, { doc: profilePayload(data), updated_at: 'z' }, emptySyncMeta('u')); sanitizeData(d); return d; })()`);
    assert.equal(other.userProgrammes.u_cc1_u_force.fromCoach.sentAt, 1000);
    assert.equal(other.programmes.u_cc1_u_force.exercises.sA[0].consigne, 'Coudes serrés');
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
    const before = run('data.programmes.u_cc1_u_force.exercises.sA.map(x => x.id)');
    run(`data.programmes.u_cc1_u_force.exercises.sA[0].tempoGuide = true; data.programmes.u_cc1_u_force.exercises.sA[0].muscles = ['chest'];
      data.history.push({ id: 'h1', programme: 'u_cc1_u_force', category: 'sA', date: Date.now() - ${DAY}, exercises: [{ exId: '${before[0]}', name: 'Développé couché', sets: [{ weight: '70', reps: '8' }] }] });`);
    sameJSON(run(`(({ status, modified }) => ({ status, modified }))(coachProgrammeStatus(data, ${JSON.stringify(v2)}, 'c1'))`), { status: 'update', modified: false });
    run(`importCoachProgramme(data, ${JSON.stringify(v2)}, { user_id: 'c1', username: 'max' })`);
    const xs = run('data.programmes.u_cc1_u_force.exercises.sA');
    assert.equal(xs[0].id, before[0], 'même nom : même identifiant');
    assert.equal(xs[0].sets, 5);
    assert.equal(xs[0].consigne, undefined, 'consigne retirée par le coach');
    assert.equal(xs[0].tempo, undefined);
    assert.equal(xs[0].tempoGuide, undefined, 'guidage retiré avec le tempo');
    sameJSON(xs[0].muscles, ['chest'], 'réglage de l\'élève gardé');
    assert.equal(xs[0].ss, undefined, 'superset défait (Rowing retiré)');
    assert.notEqual(xs[1].id, before[1]);
    assert.equal(xs[1].name, 'Tractions');
    assert.equal(run('data.userProgrammes.u_cc1_u_force.sessions.sB.label'), 'Jambes');
    assert.equal(run('data.userProgrammes.u_cc1_u_force.fromCoach.name'), 'max', 'coach gardé si non fourni');
    assert.equal(run('data.userProgrammes.u_cc1_u_force.fromCoach.sentAt'), 2000);
    run('recomputePRFromHistory()');
    sameJSON(run('data.programmes.u_cc1_u_force.exercises.sA[0].pr'), { weight: '70', reps: '8' }, 'records relus de l\'historique');
  });

  test('coach : programme modifié par l\'élève, conflit et « Garder ma version »', () => {
    reset();
    seedCoachProg();
    const v1 = inboxItem(1000), v2 = inboxItem(2000, 'p.sessions[0].exercises[0].sets = 6'), v3 = inboxItem(3000);
    reset();
    run(`importCoachProgramme(data, ${JSON.stringify(v1)}, { user_id: 'c1', username: 'max' })`);
    run('data.programmes.u_cc1_u_force.exercises.sB[0].sets = 3;');   // l'élève change ses séries
    sameJSON(run(`(({ status, modified }) => ({ status, modified }))(coachProgrammeStatus(data, ${JSON.stringify(v1)}, 'c1'))`), { status: 'current', modified: true });
    sameJSON(run(`(({ status, modified }) => ({ status, modified }))(coachProgrammeStatus(data, ${JSON.stringify(v2)}, 'c1'))`), { status: 'update', modified: true }, 'nouvel envoi : la question sera posée');
    run(`keepMyCoachProgramme(data, ${JSON.stringify(v2)}, 'c1')`);
    assert.equal(run(`coachProgrammeStatus(data, ${JSON.stringify(v2)}, 'c1').status`), 'current', 'version refusée : plus proposée');
    assert.equal(run('data.programmes.u_cc1_u_force.exercises.sB[0].sets'), 3, 'version de l\'élève intacte');
    assert.equal(run(`coachProgrammeStatus(data, ${JSON.stringify(v3)}, 'c1').status`), 'update', 'envoi suivant de nouveau proposé');
    // Supprimé par l'élève (archivé) : de nouveau « nouveau », l'import le ramène avec le même identifiant
    run('data.userProgrammes.u_cc1_u_force.archived = true;');
    assert.equal(run(`coachProgrammeStatus(data, ${JSON.stringify(v3)}, 'c1').status`), 'new');
    assert.equal(run(`importCoachProgramme(data, ${JSON.stringify(v3)}, { user_id: 'c1', username: 'max' })`), 'u_cc1_u_force');
    assert.equal(run('data.userProgrammes.u_cc1_u_force.archived'), false);
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
    // Je suis le coach c1 : u_c<mon tag>_<mon prog_id>
    const mine = id => run(`coachOwnProgrammeName(${JSON.stringify(id)}, data, 'c1')`);
    assert.equal(mine('u_cc1_u_force'), 'Force');
    assert.equal(mine('u_cc1_ppl'), run('PROGRAMMES.ppl.name'));
    assert.equal(mine('u_cc1_inconnu'), null, 'pas un de mes programmes');
    assert.equal(mine('u_cc2_u_force'), null, 'programme d\'un autre coach, même prog_id');
    assert.equal(mine('u_cu_force'), null, 'ancienne forme sans coach : pas attribuée');
    assert.equal(mine('ppl'), null);
    assert.equal(mine('u_cc1_custom'), null);
    assert.equal(run(`coachSentIdOf('u_cc1_u_force', 'c1')`), 'u_force');
    assert.equal(run(`coachLocalId('ppl', data, 'c1')`), 'u_cc1_ppl');
  });

  test('coach : badge et rôle gardés sur l\'appareil, badge de l\'onglet = social + coach', () => {
    const r = run(`(() => {
      const user = account.user, saved = { ...coach };
      try {
        account.user = { id: 'u' };
        localStorage.setItem(COACH_CACHE_KEY, JSON.stringify({ userId: 'u', isCoach: true, hasCoach: false, badge: 4, badgeCoach: 4, badgeStudent: 0 }));
        coachReset('u');
        const out = [coachRole().isCoach, coachBadge(), coachBadgeCoach(), coachBadgeStudent()];
        coach.state = cleanCoachState({ is_coach: false, coach: { user_id: 'c1', username: 'max' }, badge: 2 });
        out.push(coachRole().hasCoach, coachBadge(), coachBadgeStudent());
        coachReset('autre');
        out.push(coach.cached);
        account.user = null;
        out.push(coachBadge());
        return out;
      } finally { account.user = user; Object.assign(coach, saved); }
    })()`);
    sameJSON(r, [true, 4, 4, 0, true, 2, 2, null, 0]);
  });

  test('coach : séance retirée par le coach gardée pour l\'historique, absente des listes', () => {
    const v1 = { name: 'Force', sessions: [{ key: 'sA', label: 'Haut', color: '#FF0000', exercises: [{ name: 'Squat', sets: 3 }] },
      { key: 'sB', label: 'Jambes lourdes', color: '#00FF00', exercises: [{ name: 'Rowing', sets: 3 }] }] };
    const v2 = { ...v1, sessions: [v1.sessions[0]] };
    reset();
    run(`importCoachProgramme(data, ${JSON.stringify({ id: 'u_x', data: v1, sentAt: 1 })}, { user_id: 'c1', username: 'max' }); data.activeProgramme = 'u_cc1_u_x';`);
    run(`data.history.unshift({ id: 'hB', programme: 'u_cc1_u_x', category: 'sB', date: Date.now() - 86400000, exercises: [{ name: 'Rowing', sets: [{ weight: '50', reps: '8' }] }] }); save();`);
    run(`importCoachProgramme(data, ${JSON.stringify({ id: 'u_x', data: v2, sentAt: 2 })}, { user_id: 'c1', username: 'max' }); data.activeProgramme = 'u_cc1_u_x';`);
    assert.equal(run(`rawLabel('sB', 'u_cc1_u_x')`), 'Jambes lourdes', 'nom gardé pour l\'historique');
    assert.equal(run(`sessionMeta('sB', 'u_cc1_u_x').color`), '#00FF00');
    sameJSON(run(`sessionKeys('u_cc1_u_x')`), ['sA'], 'absente des listes');
    assert.equal(run(`progMeta('u_cc1_u_x').desc`), 'Haut');
    sameJSON(Object.keys(run(`progMeta('u_cc1_u_x').sessions`)), ['sA']);
    assert.equal(run('firstSession()'), 'sA');
    assert.equal(run(`sessionPayload(data.history.find(h => h.id === 'hB')).label`), 'Jambes lourdes', 'le nom repart juste par la synchro');
    // Empreinte sans la séance retirée : pas de « modifié par l'élève » à tort
    assert.equal(run(`coachProgrammeStatus(data, ${JSON.stringify({ id: 'u_x', data: v2, sentAt: 2 })}).modified`), false);
    // Rechargement : retired gardé (true seulement), et réordonner ne touche que les séances affichées
    run('save(); data = loadData();');
    assert.equal(run('data.userProgrammes.u_cc1_u_x.sessions.sB.retired'), true);
    assert.equal(run(`sanitizeData({ userProgrammes: { u_z: { name: 'Z', sessions: { a: { label: 'A', retired: 'oui' } } } }, programmes: {}, history: [] }).userProgrammes.u_z.sessions.a.retired`), undefined);
    run(`importCoachProgramme(data, ${JSON.stringify({ id: 'u_x', data: { ...v1, sessions: [v1.sessions[0], { ...v1.sessions[1], key: 'sC', label: 'Bas' }] }, sentAt: 3 })}, { user_id: 'c1', username: 'max' })`);
    sameJSON(run(`sessionKeys('u_cc1_u_x')`), ['sA', 'sC']);
    run(`moveSession('u_cc1_u_x', 1, 0)`);
    sameJSON(run(`sessionKeys('u_cc1_u_x')`), ['sC', 'sA'], 'ordre des séances affichées');
    assert.equal(run('data.userProgrammes.u_cc1_u_x.sessions.sB.retired'), true, 'retirée gardée à la fin');
    // Séance remise par le coach : de nouveau listée
    run(`importCoachProgramme(data, ${JSON.stringify({ id: 'u_x', data: v1, sentAt: 4 })}, { user_id: 'c1', username: 'max' })`);
    assert.equal(run('data.userProgrammes.u_cc1_u_x.sessions.sB.retired'), undefined);
    assert.ok(run(`sessionKeys('u_cc1_u_x').includes('sB')`));
  });

  test('coach : même prog_id d\'un nouveau coach, programme de l\'ancien jamais écrasé', () => {
    reset();
    const sentA = run(`cleanSentProgramme(programmeToSent(makeDefaultData(), 'ppl'))`);
    const sentB = { ...sentA, name: 'Programme B' };
    assert.equal(run(`importCoachProgramme(data, ${JSON.stringify({ id: 'ppl', data: sentA, sentAt: 1000 })}, { user_id: 'aaaaaaaa-1111', username: 'alice' })`), 'u_caaaaaaaa_ppl');
    const itemB = { id: 'ppl', data: sentB, sentAt: 5000 };
    const stB = run(`coachProgrammeStatus(data, ${JSON.stringify(itemB)}, 'bbbbbbbb-2222')`);
    sameJSON([stB.status, stB.id], ['new', 'u_cbbbbbbbb_ppl'], 'nouveau programme, autre identifiant');
    assert.equal(run(`importCoachProgramme(data, ${JSON.stringify(itemB)}, { user_id: 'bbbbbbbb-2222', username: 'bob' })`), 'u_cbbbbbbbb_ppl');
    sameJSON(run(`[data.userProgrammes.u_caaaaaaaa_ppl.name, data.userProgrammes.u_caaaaaaaa_ppl.fromCoach.name, data.userProgrammes.u_cbbbbbbbb_ppl.name]`), ['PPL', 'alice', 'Programme B']);
    assert.equal(run(`coachProgrammeStatus(data, ${JSON.stringify({ ...itemB, sentAt: 6000 })}, 'bbbbbbbb-2222').status`), 'update');
    // Compatibilité : un programme importé avant sous u_c<prog_id> par ce même coach garde sa place
    run(`data.userProgrammes.u_cppl = { ...data.userProgrammes.u_caaaaaaaa_ppl, fromCoach: { ...data.userProgrammes.u_caaaaaaaa_ppl.fromCoach } }`);
    assert.equal(run(`coachLocalId('ppl', data, 'aaaaaaaa-1111')`), 'u_cppl');
    assert.equal(run(`coachLocalId('ppl', data, 'bbbbbbbb-2222')`), 'u_cbbbbbbbb_ppl', 'jamais la place d\'un autre coach');
    // Côté coach : seules mes séances sont « Ton programme »
    run(`data.userProgrammes.u_force = { name: 'Force', sessions: {}, archived: false }`);
    assert.equal(run(`coachOwnProgrammeName('u_cbbbbbbbb_u_force', data, 'bbbbbbbb-2222')`), 'Force');
    assert.equal(run(`coachOwnProgrammeName('u_caaaaaaaa_u_force', data, 'bbbbbbbb-2222')`), null, 'programme d\'un ancien coach');
  });

  test('coach : exercice déplacé dans une autre séance, nouvel identifiant (records par séance)', () => {
    const v1 = { name: 'Force', sessions: [{ key: 'sA', label: 'Haut', color: '#FF0000', exercises: [{ name: 'Squat', sets: 3 }, { name: 'Dips', sets: 3 }] },
      { key: 'sB', label: 'Bas', color: '#00FF00', exercises: [{ name: 'Rowing', sets: 3 }] }] };
    reset();
    run(`importCoachProgramme(data, ${JSON.stringify({ id: 'u_x', data: v1, sentAt: 1 })}, { user_id: 'c1', username: 'max' })`);
    const [sq, dips] = run('data.programmes.u_cc1_u_x.exercises.sA.map(x => x.id)');
    run(`for (let i = 0; i < 3; i++) data.history.push({ id: 'h' + i, programme: 'u_cc1_u_x', category: 'sA', date: Date.now() - (i + 1) * 86400000,
      exercises: [{ exId: '${sq}', name: 'Squat', sets: [{ weight: '100', reps: '5' }] }, { exId: '${dips}', name: 'Dips', sets: [{ weight: '20', reps: '8' }] }] });
      recomputePRFromHistory();`);
    const v2 = { ...v1, sessions: [{ ...v1.sessions[0], exercises: [{ name: 'Dips', sets: 4 }] }, { ...v1.sessions[1], exercises: [{ name: 'Rowing', sets: 3 }, { name: 'Squat', sets: 3 }] }] };
    run(`importCoachProgramme(data, ${JSON.stringify({ id: 'u_x', data: v2, sentAt: 2 })}, { user_id: 'c1', username: 'max' }); recomputePRFromHistory();`);
    const moved = run('data.programmes.u_cc1_u_x.exercises.sB[1]');
    assert.notEqual(moved.id, sq, 'Squat passé dans Bas : nouvel identifiant');
    assert.equal(moved.pr, null, 'aucun record de Haut attribué à Bas');
    const kept = run('data.programmes.u_cc1_u_x.exercises.sA[0]');
    assert.equal(kept.id, dips, 'Dips resté dans Haut : même identifiant');
    sameJSON(kept.pr, { weight: '20', reps: '8' }, 'records de Dips gardés');
  });

  test('coach : boîte de l\'élève gardée sur l\'appareil (commentaires hors ligne)', () => {
    const r = run(`(() => {
      const user = account.user, saved = { ...coach };
      try {
        account.user = { id: 'u' };
        coachReset('u');
        coach.state = cleanCoachState({ is_coach: false, coach: { user_id: 'c1', username: 'max' } });
        coach.inbox = cleanInbox({ programmes: [], notes: [{ session_id: 's1', text: 'Bravo', updated_at: 5, seen: false }] });
        writeCoachInbox();
        coachReset('u');                     // relancé hors ligne : état pas encore lu
        const out = [coach.state, coachNoteFor('s1')?.text, myCoach()?.username];
        coach.state = cleanCoachState({ is_coach: false, coach: null });
        writeCoachInbox();                   // plus de coach : boîte effacée
        coachReset('u');
        out.push(coach.inbox);
        coachReset('autre');
        out.push(coach.inbox);
        return out;
      } finally { account.user = user; Object.assign(coach, saved); localStorage.removeItem(COACH_INBOX_KEY); }
    })()`);
    sameJSON(r, [null, 'Bravo', 'max', null, null]);
  });

  test('ordre des séances d\'un programme perso : gardé par la synchro (jsonb trie les clés), migration douce', () => {
    reset();
    run(`data.userProgrammes.u_sem = { name: 'Semaine', archived: false, sessions: {} };
      [['sz', 'Lundi'], ['sa', 'Mardi'], ['sm', 'Mercredi']].forEach(([k, l]) => { data.userProgrammes.u_sem.sessions[k] = { label: l, icon: '', desc: '', color: '#FF9500' }; });
      data.programmes.u_sem = { exercises: {}, timers: {}, cooldowns: {} }; save();`);
    sameJSON(run('data.userProgrammes.u_sem.order'), ['sz', 'sa', 'sm'], 'ordre écrit à l\'enregistrement (absent : ordre des clés)');
    // Autre appareil : profil relu du serveur, clés triées comme jsonb (longueur puis ordre binaire)
    const other = run(`(() => {
      const doc = JSON.parse(JSON.stringify(profilePayload(data)));
      const s = doc.userProgrammes.u_sem.sessions;
      doc.userProgrammes.u_sem.sessions = Object.fromEntries(Object.keys(s).sort().map(k => [k, s[k]]));
      const d = makeDefaultData(); applyRemoteProfile(d, { doc, updated_at: 'z' }, emptySyncMeta('u')); sanitizeData(d);
      const keep = data; data = d; const keys = sessionKeys('u_sem').map(k => rawLabel(k, 'u_sem')); data = keep; return keys;
    })()`);
    sameJSON(other, ['Lundi', 'Mardi', 'Mercredi'], 'deuxième appareil : ordre de la semaine, pas alphabétique');
    // « Modifier l'ordre » : la liste suit
    run(`moveSession('u_sem', 2, 0)`);
    sameJSON(run('data.userProgrammes.u_sem.order'), ['sm', 'sz', 'sa']);
    // Liste abîmée ou incomplète : clés inconnues retirées, séances absentes ajoutées à la fin
    sameJSON(run(`userSessionOrder({ sessions: { a: {}, b: {}, c: {} }, order: ['c', 'x', 'c', 3] })`), ['c', 'a', 'b']);
    // Programme reçu d'un coach : ordre envoyé par le coach
    const v = { name: 'F', sessions: [{ key: 'zz', label: 'Z', exercises: [] }, { key: 'aa', label: 'A', exercises: [] }] };
    run(`importCoachProgramme(data, ${JSON.stringify({ id: 'f', data: v, sentAt: 1 })}, { user_id: 'c1', username: 'max' })`);
    sameJSON(run(`data.userProgrammes.u_cc1_f.order`), ['zz', 'aa']);
  });

  test('coach : code trouvé dans ce qui est collé, élision des pseudos', () => {
    const ex = raw => run(`extractCoachCode(${JSON.stringify(raw)})`);
    assert.equal(ex(' k7m2-qx9p '), 'K7M2QX9P');
    assert.equal(ex(run(`coachInviteText('HXFZMB3V')`)), 'HXFZMB3V', 'message d\'invitation entier');
    assert.equal(ex('Salut ! Voici mon code : K7M2QX9P, à bientôt'), 'K7M2QX9P');
    assert.equal(ex('MDLF Training rejoindre'), null);
    assert.equal(ex('ABCDEFGH1'), null, '9 caractères : pas un code');
    sameJSON(['max', 'essai', 'hugo', 'Yann', 'Élise', '3pm'].map(n => run(`elide('de', ${JSON.stringify(n)})`)), ['de max', 'd\'essai', 'd\'hugo', 'de Yann', 'd\'Élise', 'de 3pm']);
    assert.equal(run(`'Ce ' + elide('que', 'essai') + ' verra'`), 'Ce qu\'essai verra');
    assert.match(run(`coachInviteText('HXFZMB3V')`), /onglet Amis › Rejoindre un coach/);
  });

  test('coach : élèves retirés, « vu » renvoyé plus tard, consigne d\'un programme intégré gardée', () => {
    const st = run(`cleanCoachState({ is_coach: true, removed: [{ user_id: 'z', username: 'zoe' }, { username: 'sans_id' }] })`);
    sameJSON(st.removed.map(p => p.username), ['zoe']);
    assert.equal(run(`cleanCoachState({ is_coach: false, removed: [{ user_id: 'z' }] }).removed.length`), 0);
    const q = run(`(() => {
      const saved = { ...coach };
      try {
        coach.userId = 'u';
        coachQueueSeen('note', 's1'); coachQueueSeen('programme', 'p1'); coachQueueSeen('note', 's1');
        const a = coachSeenQueue().map(x => x.kind + ':' + x.ref);
        coach.userId = 'autre';
        const b = coachSeenQueue().length;
        coach.userId = 'u'; coachSaveSeenQueue([]);
        return [a, b, coachSeenQueue().length];
      } finally { Object.assign(coach, saved); }
    })()`);
    sameJSON(q, [['programme:p1', 'note:s1'], 0, 0]);
    reset();
    run(`data.programmes.ppl.consigne = '  Trois fois par semaine  '; data.programmes.ppl.exercises.push[0].consigne = 'Coudes serrés'; save(); data = loadData();`);
    assert.equal(run('data.programmes.ppl.consigne'), 'Trois fois par semaine', 'gardée et bornée par sanitizeData');
    const p = run(`programmeToSent(data, 'ppl')`);
    assert.equal(p.consigne, 'Trois fois par semaine', 'programme intégré : consigne reprise au renvoi');
    assert.equal(p.sessions[0].exercises[0].consigne, 'Coudes serrés');
  });

  test('coach : état des programmes envoyés (sent du serveur, sinon déduction locale)', () => {
    const st = run(`cleanCoachState({ is_coach: true, students: [{ user_id: 'e', username: 'lea', sent: [
      { id: 'u_a', sent_at: 1000, seen: false }, { id: 'u_b', sent_at: 2000, seen: true }, { id: 'u_c', sent_at: 3000, seen: true }, { id: '../x' }] }] })`);
    sameJSON(st.students[0].sent.map(x => x.id), ['u_a', 'u_b', 'u_c'], 'identifiants sûrs seulement');
    assert.equal(run(`cleanCoachState({ is_coach: true, students: [{ user_id: 'e' }] }).students[0].sent`), null, 'champ absent : null (repli)');
    const r = run(`(() => {
      const user = account.user, saved = { ...coach };
      try {
        account.user = { id: 'c1' };
        coach.userId = 'c1';
        coach.state = ${JSON.stringify(st)};
        const rows = [{ doneAt: 2500, s: { programme: 'u_cc1_u_b' } }, { doneAt: 2500, s: { programme: 'u_cc1_u_c' } }];
        const server = coachSentStatus('e', rows).map(x => x.progId + ':' + x.state);
        coach.state = cleanCoachState({ is_coach: true, students: [{ user_id: 'e' }] });
        localStorage.removeItem(COACH_SENT_KEY);
        coachRecordSent('e', 'u_z', 100); coachRecordSent('e', 'u_y', 100);
        const local = coachSentStatus('e', [{ doneAt: 200, s: { programme: 'u_cc1_u_y' } }]).map(x => x.progId + ':' + x.state);
        return [server, local];
      } finally { account.user = user; Object.assign(coach, saved); localStorage.removeItem(COACH_SENT_KEY); }
    })()`);
    sameJSON(r, [['u_c:unused', 'u_b:used', 'u_a:unseen'], ['u_z:unused']]);
  });

  test('synchro après la mise à jour : l\'ordre des séances ajouté au chargement ne fait pas gagner cet appareil', () => {
    const r = run(`(() => {
      // iPhone sur la version précédente : programme perso sans order, profil synchronisé (empreinte d'avant)
      const old = makeDefaultData(); old.schema = SCHEMA;
      old.userProgrammes.u_aaaaaaaa = { name: 'Mon prog', archived: false, sessions: {
        sZ: { label: 'Haut', icon: '', desc: '', color: '#FF0000' }, sA: { label: 'Bas', icon: '', desc: '', color: '#00FF00' } } };
      old.history = [{ id: 'h1', date: 1e12, programme: 'u_aaaaaaaa', category: 'sZ', exercises: [] }];
      sanitizeData(old); delete old.userProgrammes.u_aaaaaaaa.order;   // état laissé par la version précédente
      const meta = { userId: 'u', cursor: null, pushed: {}, profileHash: syncHash(profilePayload(old)), profileAt: '2026-10-27T10:00:00Z' };
      // Compte modifié ailleurs (iPad, version précédente) : lbs, programme renommé ; clés triées par jsonb
      const doc = JSON.parse(JSON.stringify(profilePayload(old)));
      doc.unit = 'lbs'; doc.userProgrammes.u_aaaaaaaa.name = 'Renommé sur iPad';
      const ss = doc.userProgrammes.u_aaaaaaaa.sessions;
      doc.userProgrammes.u_aaaaaaaa.sessions = Object.fromEntries(Object.keys(ss).sort().map(k => [k, ss[k]]));
      // Mise à jour : chargement (sanitizeData pose order), puis première synchro
      const d = sanitizeData(JSON.parse(JSON.stringify(old)));
      const changed = applyRemoteProfile(d, { doc, updated_at: '2026-10-27T11:00:00Z' }, meta);
      sanitizeData(d);
      const keep = data; data = d; const labels = sessionKeys('u_aaaaaaaa').map(k => rawLabel(k, 'u_aaaaaaaa')); data = keep;
      const first = [changed, d.unit, d.userProgrammes.u_aaaaaaaa.name, labels];
      // Synchro suivante : le compte a encore son profil sans order, toujours rien d'écrasé
      doc.unit = 'kg'; doc.weeklyGoal = 5;
      const changed2 = applyRemoteProfile(d, { doc, updated_at: '2026-10-27T12:00:00Z' }, meta);
      return [...first, changed2, d.unit, d.weeklyGoal, d.userProgrammes.u_aaaaaaaa.order];
    })()`);
    sameJSON(r, [true, 'lbs', 'Renommé sur iPad', ['Haut', 'Bas'], true, 'kg', 5, ['sZ', 'sA']]);
    // Vraiment modifié ici (pas seulement l'ordre ajouté) : cet appareil garde ses changements, comme avant
    const r2 = run(`(() => {
      const d = makeDefaultData(); d.history = [{ id: 'h', date: 1, category: 'push', exercises: [] }];
      const meta = { userId: 'u', cursor: null, pushed: {}, profileHash: syncHash(profilePayload(d)), profileAt: 'a' };
      const doc = JSON.parse(JSON.stringify(profilePayload(d))); doc.defaultRest = 120;
      d.unit = 'lbs';
      applyRemoteProfile(d, { doc, updated_at: 'b' }, meta);
      return [d.unit, d.defaultRest];
    })()`);
    sameJSON(r2, ['lbs', 90]);
  });

  test('coach : élèves retirés triés, nom d\'un programme envoyé puis supprimé', () => {
    const st = run(`cleanCoachState({ is_coach: true, removed: [{ user_id: 'a', username: 'ana', since: '2026-10-01T00:00:00Z' }, { user_id: 'b', username: 'bob', since: '2026-10-20T00:00:00Z' }] })`);
    sameJSON(st.removed.map(p => p.username), ['bob', 'ana'], 'du plus récent au plus ancien');
    const r = run(`(() => {
      const saved = { ...coach };
      try {
        coach.userId = 'c1';
        localStorage.removeItem(COACH_SENT_KEY);
        coachRecordSent('e', 'u_parti', 100, 'Ancien programme');
        localStorage.setItem(COACH_SENT_KEY, JSON.stringify({ userId: 'c1', sent: { e: { ...JSON.parse(localStorage.getItem(COACH_SENT_KEY)).sent.e, u_vieux: 50 } } }));
        return [coachSentName('e', 'u_parti'), coachSentName('e', 'ppl'), coachSentName('e', 'u_vieux'), coachUnusedSent('e', []).map(x => x.progId + ':' + x.sentAt).sort()];
      } finally { Object.assign(coach, saved); localStorage.removeItem(COACH_SENT_KEY); }
    })()`);
    sameJSON(r, ['Ancien programme', run('PROGRAMMES.ppl.name'), 'Programme supprimé', ['u_parti:100', 'u_vieux:50']]);
  });
}
