// Bilans configurables, côté élève (js/data/checkin-student.js, docs/BILANS.md « App iPhone (élève) ») :
// préremplissage, période, brouillon par compte, envoi idempotent (un seul appel, hors ligne gardé puis renvoyé),
// filtre du cycle (accord, âge), effacement à la déconnexion, ouverture par notification.
// Faux serveur : sb.rpc remplacé par une fonction qui compte ses appels. Identifiants factices.

export default function ({ test, run, reset, assert, sameJSON }) {
  const j = v => JSON.stringify(v);
  const NOW = new Date(2026, 10, 24, 10, 0).getTime();   // mardi 24 novembre 2026, 10 h
  const DAY = 86400e3;
  const ID1 = '11111111-1111-4111-8111-111111111111', ID2 = '22222222-2222-4222-8222-222222222222', ID3 = '33333333-3333-4333-8333-333333333333';
  const COACH = 'c0000000-0000-4000-8000-00000000000c';
  const ITEMS = [
    { key: 'weight', kind: 'weight', label: 'Poids', type: 'number', required: true, unit: 'kg' },
    { key: 'measures', kind: 'measures', label: 'Mensurations', type: 'number', required: false, unit: 'cm', options: { keys: ['waist', 'hips', 'thighL'] } },
    { key: 'diet_adherence', kind: 'diet_adherence', label: 'Respect du plan diète', type: 'auto', required: false },
    { key: 'training_adherence', kind: 'training_adherence', label: 'Respect de l\'entraînement', type: 'auto', required: false },
    { key: 'steps', kind: 'steps', label: 'Pas par jour', type: 'number', required: false, unit: 'steps' },
    { key: 'sleep', kind: 'sleep', label: 'Sommeil', type: 'scale', required: false, scale: 5, lo: 'Mal', hi: 'Très bien' },
    { key: 'cycle', kind: 'cycle', label: 'Cycle menstruel', type: 'choice', required: false },
  ];
  const rawReq = (id, o = {}) => ({ id, coach_id: COACH, name: 'Bilan de la semaine', items: ITEMS, period_start: '2026-11-24',
    sent_at: new Date(NOW - 3600e3).toISOString(), due_at: new Date(NOW + DAY).toISOString(), answered_at: null, review: null, ...o });

  // Élève u1 connectée, coach COACH ; rpc : réponses programmées par nom de fonction
  function setup({ consent = false, requests = [rawReq(ID1)] } = {}) {
    reset();
    run(`account.user = { id: 'u1' }; coach.state = { coach: { user_id: ${j(COACH)}, username: 'alex' }, is_coach: false, students: [] };
      ageRange.stored = null; ckReset('u1');
      globalThis.__calls = []; globalThis.__srv = { offline: false, answered: {} };
      sb = { rpc: async (fn, args) => {
        __calls.push([fn, args]);
        if (__srv.offline) throw new TypeError('Failed to fetch');
        if (fn === 'student_checkins') return { data: { requests: ${j(requests)}, cycle: { consented: ${consent} } }, error: null };
        if (fn === 'student_checkin_answer') { __srv.answered[args.request] ||= '2026-11-24T09:30:00.000Z'; return { data: { answered_at: __srv.answered[args.request] }, error: null }; }
        if (fn === 'student_checkin_cycle') return { data: { consented: !!args.accept }, error: null };
        return { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
      } };`);
  }
  const calls = fn => run(`__calls.filter(c => c[0] === ${j(fn)}).length`);

  test('bilans élève : lecture, liste du coach actuel, demandes à remplir', async () => {
    setup({ requests: [rawReq(ID1), rawReq(ID2, { answered_at: new Date(NOW - DAY).toISOString(), review: { reply: 'Bravo', reviewed_at: new Date(NOW).toISOString() } })] });
    assert.equal(await run('checkinRefresh()'), true);
    sameJSON(run('checkinOpen().map(r => r.id)'), [ID1]);
    assert.equal(run(`checkinState(checkinById(${j(ID2)}))`), 'sent');
    assert.equal(run(`checkinById(${j(ID2)}).review.reply`), 'Bravo');
    // Liste gardée d'un ancien coach : rien ne s'affiche
    run(`coach.state.coach = { user_id: 'autre' }`);
    assert.equal(run('checkinList().length'), 0);
    // Serveur sans les bilans : indisponible, rien à remplir
    setup(); run(`sb.rpc = async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.student_checkins' } })`);
    await run('checkinRefresh()');
    assert.equal(run('ck.available'), false);
    assert.equal(run('checkinOpen().length'), 0);
  });

  test('bilans élève : période (7 jours, écart avec le bilan précédent, 31 au plus) et textes', () => {
    setup();
    const req = { id: ID1, name: 'Hebdo', sentAt: NOW };
    assert.equal(run(`checkinPeriod(${j(req)}, []).days`), 7);
    sameJSON(run(`checkinPeriod(${j(req)}, []).keys`), ['2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24']);
    assert.equal(run(`checkinPeriod(${j(req)}, [${j({ id: ID2, name: 'Hebdo', sentAt: NOW - 14 * DAY })}]).days`), 14);
    assert.equal(run(`checkinPeriod(${j(req)}, [${j({ id: ID2, name: 'Hebdo', sentAt: NOW - 60 * DAY })}]).days`), 31);
    assert.equal(run(`checkinPeriod(${j(req)}, [${j({ id: ID2, name: 'Autre', sentAt: NOW - 14 * DAY })}]).days`), 7, 'autre bilan : pas pris en compte');
    assert.equal(run(`checkinPeriodText(${j(req)}, [])`), 'Du 18 au 24 nov.', 'mardi : pas une semaine du calendrier');
    assert.equal(run(`checkinPeriodText(${j({ ...req, sentAt: NOW + 5 * DAY })}, [])`), 'Semaine 48', 'envoyé le dimanche : la semaine 48');
    assert.equal(run('checkinIsoWeek(new Date(2027, 0, 1).getTime())'), 53, '1er janvier 2027 : semaine 53 de 2026');
    assert.equal(run('checkinIsoWeek(new Date(2026, 0, 1).getTime())'), 1, '1er janvier 2026 (jeudi) : semaine 1');
    assert.equal(run(`checkinDueText({ dueAt: ${NOW + DAY} }, ${NOW})`), 'à rendre demain');
    assert.equal(run(`checkinDueText({ dueAt: ${NOW + 3 * DAY} }, ${NOW})`), 'à rendre vendredi');
    assert.equal(run(`checkinDueText({ dueAt: ${NOW - DAY} }, ${NOW})`), 'en retard depuis hier');
    assert.equal(run('checkinPlanned(14, 4)'), 8);
    assert.equal(run('checkinPlanned(7, 0)'), 3, 'sans objectif : 3 par semaine');
  });

  test('bilans élève : préremplissage (pesée, mensurations, diète, séances), jamais « 0 jour » sans diète', async () => {
    setup();
    await run('checkinRefresh()');
    run(`data.bodyWeightLog = [{ date: ${NOW - 2 * DAY}, kg: 63.1 }, { date: ${NOW - 3600e3}, kg: 62.2 }];
      data.bodyMeasures = { waist: [{ date: ${NOW - 5 * DAY}, cm: 68.5 }], hips: [{ date: ${NOW - 5 * DAY}, cm: 94.5 }] };
      data.history = [${[1, 2, 4, 6, 9].map(d => `{ id: 'h${d}', date: ${NOW - d * DAY}, programme: 'ppl', category: 'push', exercises: [] }`).join(',')}];`);
    const req = `checkinById(${j(ID1)})`;
    // Sans plan diète : rien de prérempli pour la diète
    let ctx = run(`checkinContext(${req}, { goal: 4, now: ${NOW} })`);
    sameJSON(ctx.dietDays, []);
    assert.equal(ctx.sessions, 4, 'séances des 7 jours (jour d\'envoi compris)');
    assert.equal(ctx.planned, 4);
    let pre = run(`checkinPrefill(checkinItemsShown(${req}), checkinContext(${req}, { goal: 4, now: ${NOW} }))`);
    assert.equal(pre.values.weight, 62.2, 'dernière pesée');
    sameJSON(pre.values.measures, { waist: 68.5, hips: 94.5 }, 'mensurations demandées seulement, les connues');
    sameJSON(pre.values.training_adherence, { done: 4, of: 4 });
    assert.equal(Object.hasOwn(pre.values, 'diet_adherence'), false);
    assert.equal(Object.hasOwn(pre.values, 'steps'), false, 'pas : à la main sans lecture de Santé');
    // Diète : 5 jours suivis, 1 partiel, 1 rien de noté
    run('globalThis.__savedDsd = dietShareDay');
    run(`dietShareDay = (d, day) => day === '2026-11-21' ? null : ({ day, kcal: 2000, goal: { kcal: day === '2026-11-22' ? 2600 : 2000 }, meals: [] });`);
    ctx = run(`checkinContext(${req}, { goal: 4, now: ${NOW} })`);
    assert.equal(ctx.dietDays.length, 7);
    pre = run(`checkinPrefill(checkinItemsShown(${req}), checkinContext(${req}, { goal: 4, now: ${NOW} }))`);
    sameJSON(pre.values.diet_adherence, { done: 5, of: 7 });
    run('dietShareDay = __savedDsd');
    // Pas lus dans Santé (coquille qui sait les lire)
    pre = run(`checkinPrefill(checkinItemsShown(${req}), checkinContext(${req}, { goal: 4, now: ${NOW}, steps: 8900.4 }))`);
    assert.equal(pre.values.steps, 8900);
    assert.equal(pre.from.steps, 'health');
  });

  test('bilans élève : brouillon par compte et par demande, repris au retour, effacé à l\'envoi', async () => {
    setup();
    await run('checkinRefresh()');
    run(`checkinDraftSave(${j(ID1)}, { answers: { weight: '61,8', sleep: 4 }, skipped: ['measures'] })`);
    let st = run(`checkinStart(checkinById(${j(ID1)}), { weights: [{ date: ${NOW}, kg: 62.2 }] })`);
    assert.equal(st.answers.weight, '61,8', 'le brouillon passe avant le préremplissage');
    assert.equal(st.answers.sleep, 4);
    assert.equal(run('[...checkinStart(checkinById(' + j(ID1) + '), {}).skipped].join()'), 'measures');
    // Autre compte sur l'iPhone : il ne lit pas ce brouillon
    run(`ck.userId = 'u2'`);
    assert.equal(run(`checkinDraft(${j(ID1)})`), null);
    run(`ck.userId = 'u1'`);
    assert.ok(run(`checkinDraft(${j(ID1)})`));
    // Demande plus ouverte (répondue ailleurs) : brouillon retiré à la lecture suivante
    run(`sb.rpc = (old => async (fn, a) => fn === 'student_checkins' ? { data: { requests: [${j(rawReq(ID1, { answered_at: new Date(NOW).toISOString() }))}], cycle: { consented: false } }, error: null } : old(fn, a))(sb.rpc)`);
    await run('checkinRefresh()');
    assert.equal(run(`checkinDraft(${j(ID1)})`), null);
  });

  test('bilans élève : envoi idempotent, un seul appel, obligatoires vérifiés', async () => {
    setup();
    await run('checkinRefresh()');
    let r = await run(`checkinSend(${j(ID1)}, { sleep: 3 })`);
    assert.equal(r.kind, 'missing'); sameJSON(r.missing, ['weight']);
    assert.equal(calls('student_checkin_answer'), 0, 'rien d\'envoyé sans le poids obligatoire');
    run(`checkinDraftSave(${j(ID1)}, { answers: { weight: '62,2' } })`);
    const both = await run(`Promise.all([checkinSend(${j(ID1)}, { weight: '62,2', sleep: 3, steps: '8 900' }), checkinSend(${j(ID1)}, { weight: '62,2', sleep: 3 })])`);
    assert.equal(both[0].ok, true);
    assert.equal(both[1].kind === 'busy' || both[1].queued === true, true, 'deuxième envoi pendant le premier : refusé ou déjà en file');
    assert.equal(calls('student_checkin_answer'), 1, 'un seul appel');
    sameJSON(run(`__calls.find(c => c[0] === 'student_checkin_answer')[1].answers`), { weight: 62.2, steps: 8900, sleep: 3 }, 'réponses nettoyées (virgule, espaces)');
    r = await run(`checkinSend(${j(ID1)}, { weight: '62,2' })`);
    assert.equal(r.ok, true);
    assert.equal(calls('student_checkin_answer'), 1, 'déjà envoyé : aucun nouvel appel');
    assert.equal(run(`checkinState(checkinById(${j(ID1)}))`), 'sent');
    assert.equal(run(`checkinDraft(${j(ID1)})`), null, 'brouillon effacé à l\'envoi');
    // Passé : retiré même s'il avait une valeur
    setup();
    await run('checkinRefresh()');
    await run(`checkinSend(${j(ID1)}, { weight: 62, sleep: 2 }, ['sleep'])`);
    sameJSON(run(`__calls.find(c => c[0] === 'student_checkin_answer')[1].answers`), { weight: 62 });
  });

  test('bilans élève : hors ligne, la réponse est gardée puis renvoyée une seule fois au retour du réseau', async () => {
    setup();
    await run('checkinRefresh()');
    run('__srv.offline = true');
    const r = await run(`checkinSend(${j(ID1)}, { weight: 62.2 })`);
    assert.equal(r.ok, true); assert.equal(r.queued, true);
    assert.equal(run(`checkinState(checkinById(${j(ID1)}))`), 'queued');
    assert.equal(run('checkinOpen().length'), 0, 'plus dans « à remplir »');
    const again = await run(`checkinSend(${j(ID1)}, { weight: 62.2 })`);
    assert.equal(again.queued, true);
    assert.equal(calls('student_checkin_answer'), 1, 'en file : pas de nouvel appel');
    run('__srv.offline = false');
    await run('checkinRefresh()');
    assert.equal(calls('student_checkin_answer'), 2, 'renvoyée au retour du réseau');
    sameJSON(run('Object.keys(checkinOutbox())'), []);
    await run('checkinFlush()');
    assert.equal(calls('student_checkin_answer'), 2, 'plus rien en file');
  });

  test('bilans élève : cycle filtré sans accord, jamais proposé à un mineur, retrait', async () => {
    setup({ consent: false });
    await run('checkinRefresh()');
    assert.equal(run(`checkinItemsShown(checkinById(${j(ID1)})).some(i => i.kind === 'cycle')`), false, 'sans accord : pas de cycle');
    await run(`checkinSend(${j(ID1)}, { weight: 62, cycle: 'luteal' })`);
    sameJSON(run(`__calls.find(c => c[0] === 'student_checkin_answer')[1].answers`), { weight: 62 }, 'phase jamais envoyée sans accord');
    setup({ consent: true });
    await run('checkinRefresh()');
    assert.equal(run(`checkinItemsShown(checkinById(${j(ID1)})).some(i => i.kind === 'cycle')`), true, 'accord : cycle montré');
    // Tranche d'âge d'Apple 15-17 ans : ni montré, ni accord possible, sans appel au serveur
    run(`ageRange.stored = { status: 'sharing', lowerBound: 15, upperBound: 17, communicationLimits: false, at: Date.now() }`);
    assert.equal(run('checkinCycleBlocked()'), true);
    assert.equal(run(`checkinItemsShown(checkinById(${j(ID1)})).some(i => i.kind === 'cycle')`), false);
    const r = await run('checkinCycleSet(true, true)');
    assert.equal(r.kind, 'not_adult');
    assert.equal(calls('student_checkin_cycle'), 0);
    // Adulte (ou tranche inconnue) : accord seulement avec « 18 ans ou plus » coché, puis retrait
    run(`ageRange.stored = null`);
    assert.equal((await run('checkinCycleSet(true, false)')).kind, 'not_adult');
    assert.equal((await run('checkinCycleSet(true, true)')).ok, true);
    sameJSON(run(`__calls.filter(c => c[0] === 'student_checkin_cycle').map(c => c[1])`), [{ accept: true, adult: true }]);
    run(`checkinDraftSave(${j(ID1)}, { answers: { cycle: 'menses', weight: 62 } })`);
    run(`sb.rpc = (old => async (fn, a) => fn === 'student_checkins' ? { data: { requests: [${j(rawReq(ID1))}], cycle: { consented: false } }, error: null } : old(fn, a))(sb.rpc)`);
    assert.equal((await run('checkinCycleSet(false)')).consented, false);
    sameJSON(run(`checkinDraft(${j(ID1)}).answers`), { weight: 62 }, 'retrait : phase effacée du brouillon');
  });

  test('bilans élève : déconnexion, rien ne reste ; quitter son coach efface aussi', async () => {
    setup();
    await run('checkinRefresh()');
    run(`checkinDraftSave(${j(ID1)}, { answers: { weight: 62 } }); __srv.offline = true;`);
    await run(`checkinSend(${j(ID3)}, {})`);
    assert.ok(run(`localStorage.getItem('mdlf_checkins')`));
    run(`ckReset(null)`);
    for (const k of ['mdlf_checkins', 'mdlf_checkin_drafts', 'mdlf_checkin_outbox', 'mdlf_checkin_sent']) assert.equal(run(`localStorage.getItem(${j(k)})`), null, k);
    setup();
    await run('checkinRefresh()');
    run(`checkinDraftSave(${j(ID1)}, { answers: { weight: 62 } })`);
    run('coach.state.coach = null; ckForgetCoach()');
    assert.equal(run(`localStorage.getItem('mdlf_checkin_drafts')`), null);
    assert.equal(run('ck.requests.length'), 0);
  });

  test('bilans élève : notification checkin et rappel → écran du bilan', () => {
    sameJSON(run(`pushTarget({ kind: 'checkin', ref: ${j(ID1)} })`), { tab: 'train', screen: 'checkin', params: [ID1] });
    sameJSON(run(`pushTarget({ kind: 'checkin_reminder', ref: ${j(ID1)} })`), { tab: 'train', screen: 'checkin', params: [ID1] });
    sameJSON(run(`pushTarget({ kind: 'checkin', ref: '../x' })`), { tab: 'train', screen: null, params: [] });
  });

  test('bilans élève : nettoyage de student_checkins (jamais la note du coach)', () => {
    const st = run(`cleanStudentCheckins({ requests: [${j(rawReq(ID1, { review: { reply: 'Ok', score: 9, reviewed_at: new Date(NOW).toISOString() } }))}, { id: 'pas-un-uuid' }], cycle: { consented: true, asked: true } })`);
    assert.equal(st.requests.length, 1);
    assert.equal(st.cycle, true); assert.equal(st.cycleAsked, true);
    assert.equal(st.requests[0].coach, COACH);
    sameJSON(run(`cleanStudentCheckins(null)`), { requests: [], cycle: false, cycleAsked: false, adult: null, adultAsked: false, health: null });
    // Accord daté et majorité (20261127030000_bilans_accord_majeur.sql)
    const h = run(`cleanStudentCheckins({ requests: [], adult: false, adult_asked: true, health: { consented: true, version: 1, current: 1, at: '2026-11-25T10:00:00Z' } })`);
    assert.equal(h.adult, false); assert.equal(h.adultAsked, true);
    sameJSON(h.health, { consented: true, version: 1, at: Date.parse('2026-11-25T10:00:00Z') });
    assert.equal(run(`cleanStudentCheckins({ adult: 'oui', health: [] }).adult`), null);
    assert.equal(run(`cleanStudentCheckins({ health: [] }).health`), null);
  });
}
