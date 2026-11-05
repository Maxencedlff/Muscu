// Planification du coach (js/data/coach-plan.js) : jours du calendrier, où en est une phase, chevauchement
// (même règle que le serveur), nettoyage de ce que renvoie le serveur (jamais la note côté élève), saisie,
// serveur sans la planification, cache par compte et par coach.
import fs from 'node:fs';
import path from 'node:path';

export default function ({ test, run, reset, assert, sameJSON, ROOT }) {
  const setup = () => run(`(() => {
    globalThis.__calls = [];
    globalThis.__answers = {};
    account.user = { id: 'u1' };
    planReset('u1');
    coach.userId = 'u1';
    coach.state = cleanCoachState({ is_coach: true, coach: null, students: [{ user_id: 's1', username: 'lea', since: '2026-10-01' }] });
    sb = { rpc: async (fn, args) => {
      __calls.push([fn, args === undefined ? null : JSON.parse(JSON.stringify(args))]);
      const a = __answers[fn];
      const v = typeof a === 'function' ? a(args) : a;
      return v && v.error ? { data: null, error: v.error } : { data: v ?? null, error: null };
    } };
  })()`);
  const teardown = () => run('sb = null; account.user = null; coach.state = null; planReset(null); delete globalThis.__calls; delete globalThis.__answers;');
  const planCalls = () => run('__calls').filter(c => /plan/.test(c[0])).map(c => c[0]);
  const P = (o = {}) => ({ id: 1, name: '', goal: 'mini_cut', start: '2026-11-09', weeks: 6, progName: null, ...o });
  const J = o => JSON.stringify(o);

  test('planification : mêmes objectifs et mêmes bornes que le serveur', () => {
    const sql = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261105000000_coach_planning.sql'), 'utf8');
    const goals = run('PLAN_GOAL_IDS');
    assert.ok(sql.includes(`goal in (${goals.map(g => `'${g}'`).join(', ')})`), 'liste des objectifs identique');
    assert.match(sql, /weeks between 1 and 52/);
    assert.equal(run('PLAN_MAX_WEEKS'), 52);
    assert.match(sql, />= 30 then\s+raise exception 'too_many'/);
    assert.equal(run('PLAN_MAX_PHASES'), 30);
    assert.match(sql, /char_length\(name\) <= 40/);
    assert.match(sql, /char_length\(note\) <= 500/);
    sameJSON([run('PLAN_NAME_MAX'), run('PLAN_NOTE_MAX'), run('PLAN_PROG_MAX')], [40, 500, 40]);
  });

  test('planification : jours du calendrier, sans fuseau ni heure d\'été', () => {
    assert.equal(run(`planDayNum('2026-02-30')`), null, 'date qui n\'existe pas');
    assert.equal(run(`planDayNum('9 nov.')`), null);
    assert.equal(run(`planAddDays('2026-10-24', 7)`), '2026-10-31', 'à travers le changement d\'heure du 25 oct.');
    assert.equal(run(`planAddDays('2026-12-28', 7)`), '2027-01-04');
    assert.equal(run(`phaseLastDay(${J(P())})`), '2026-12-20', '6 semaines à partir du lundi 9 nov. : jusqu\'au dimanche 20 déc.');
  });

  test('planification : où en est la phase (semaine 3 sur 6), avant, pendant, après', () => {
    const p = J(P());
    sameJSON(run(`phaseProgress(${p}, '2026-11-08')`), { status: 'upcoming', week: 0, day: 0, daysLeft: 42, daysTo: 1 });
    assert.equal(run(`phaseStatusText(${p}, '2026-11-08')`), 'Demain');
    assert.equal(run(`phaseStatusText(${p}, '2026-11-04')`), 'Dans 5 jours');
    assert.equal(run(`phaseStatusText(${p}, '2026-10-19')`), 'Dans 3 semaines');
    assert.equal(run(`phaseStatusText(${p}, '2026-11-09')`), 'Semaine 1 sur 6', 'premier jour');
    assert.equal(run(`phaseStatusText(${p}, '2026-11-15')`), 'Semaine 1 sur 6', 'septième jour');
    assert.equal(run(`phaseStatusText(${p}, '2026-11-16')`), 'Semaine 2 sur 6');
    assert.equal(run(`phaseStatusText(${p}, '2026-11-25')`), 'Semaine 3 sur 6');
    sameJSON(run(`phaseProgress(${p}, '2026-12-20')`), { status: 'current', week: 6, day: 42, daysLeft: 1, daysTo: 0 }, 'dernier jour');
    assert.equal(run(`phaseStatusText(${p}, '2026-12-21')`), 'Terminée');
    assert.match(run(`phaseRangeText(${p})`), /^Du 9 nov\. au 20 déc\.$/);
    assert.equal(run(`phaseTitle(${p})`), 'Mini cut', 'sans nom : l\'objectif');
    assert.equal(run(`phaseTitle(${J(P({ name: 'Sèche Dylan' }))})`), 'Sèche Dylan');
  });

  test('planification : phase en cours, prochaine, début proposé, chevauchement comme le serveur', () => {
    const list = J([P({ id: 2, goal: 'bulk', start: '2026-12-21', weeks: 12 }), P({ id: 1 }), P({ id: 3, goal: 'comeback', start: '2026-10-26', weeks: 2 })]);
    assert.equal(run(`planCurrent(${list}, '2026-11-25').id`), 1);
    assert.equal(run(`planNext(${list}, '2026-11-25').id`), 2);
    assert.equal(run(`planCurrent(${list}, '2028-01-01')`), null);
    sameJSON(run(`planSorted(${list}).map(p => p.id)`), [3, 1, 2]);
    // Nouvelle phase : le lendemain de la dernière ; tout est fini : aujourd'hui
    assert.equal(run(`planNextStart(${list}, '2026-11-25')`), '2027-03-15');
    assert.equal(run(`planNextStart(${list}, '2027-06-01')`), '2027-06-01');
    assert.equal(run(`planNextStart([], '2026-11-25')`), '2026-11-25');
    // Chevauchement : bord à bord accepté, un jour de trop refusé, la phase elle-même ignorée
    assert.equal(run(`planOverlap(${list}, { id: null, start: '2027-03-15', weeks: 4 })`), null);
    assert.equal(run(`planOverlap(${list}, { id: null, start: '2027-03-14', weeks: 4 }).id`), 2);
    assert.equal(run(`planOverlap(${list}, { id: null, start: '2026-10-27', weeks: 2 }).id`), 3);
    assert.equal(run(`planOverlap(${list}, { id: 1, start: '2026-11-09', weeks: 6 })`), null, 'modifier une phase sans la déplacer');
    assert.equal(run(`planOverlap(${list}, { id: 1, start: '2026-11-09', weeks: 7 }).id`), 2);
  });

  test('planification : nettoyage du serveur, jamais de note côté élève', () => {
    const raw = { id: 7, name: '  Mini\u0007 cut  ', goal: 'mini_cut', start: '2026-11-09', weeks: 6, prog_name: 'Sèche 4 jours', note: 'objectif −3 kg', coach_id: 'c1' };
    sameJSON(run(`cleanPlanPhase(${J(raw)}, true)`), { id: 7, name: 'Mini cut', goal: 'mini_cut', start: '2026-11-09', weeks: 6, progName: 'Sèche 4 jours', note: 'objectif −3 kg' });
    sameJSON(Object.keys(run(`cleanStudentPlan(${J({ coach: true, phases: [raw] })})[0]`)), ['id', 'name', 'goal', 'start', 'weeks', 'progName'], 'élève : ni note ni coach');
    for (const bad of [{ ...raw, goal: 'sumo' }, { ...raw, weeks: 0 }, { ...raw, weeks: 53 }, { ...raw, start: '2026-13-01' }, { ...raw, id: -1 }, { ...raw, id: 'x' }, null, 5]) {
      assert.equal(run(`cleanPlanPhase(${J(bad)})`), null, J(bad));
    }
    sameJSON(run(`cleanStudentPlan({ coach: false, phases: [${J(raw)}] })`), [], 'sans coach : rien');
    const cp = run(`cleanCoachPlans({ students: [{ student_id: 's1', phases: [${J(raw)}, { id: 8 }] }, { student_id: '', phases: [] }, null] })`);
    sameJSON(Object.keys(cp), ['s1']);
    assert.equal(cp.s1.length, 1);
    sameJSON(run('cleanCoachPlans(null)'), {});
  });

  test('planification : saisie du coach bornée avant l\'envoi', () => {
    const ok = run(`planSaveArgs('s1', { goal: 'cut', start: '2026-11-09', weeks: 6, name: '  Sèche  ', progName: '', note: ' x \\r\\n' })`);
    sameJSON(ok.args, { student: 's1', phase_id: null, name: 'Sèche', goal: 'cut', start_date: '2026-11-09', weeks: 6, programme: null, note: 'x' });
    assert.equal(run(`planSaveArgs('s1', { id: 4, goal: 'cut', start: '2026-11-09', weeks: 6 })`).args.phase_id, 4);
    assert.equal(run(`planSaveArgs('s1', { goal: '', start: '2026-11-09', weeks: 6 })`).error, 'goal');
    assert.equal(run(`planSaveArgs('s1', { goal: 'cut', start: '', weeks: 6 })`).error, 'start');
    assert.equal(run(`planSaveArgs('s1', { goal: 'cut', start: '2026-11-09', weeks: 60 })`).error, 'weeks');
    assert.equal(run(`planSaveArgs('s1', { goal: 'cut', start: '2026-11-09', weeks: 6, note: 'x'.repeat(501) })`).error, 'too_long');
  });

  test('planification : serveur sans la planification, rien ne s\'affiche ; ensuite rien n\'est relu à tort', async () => {
    reset();
    try {
      setup();
      assert.equal(run('planAvailable()'), false, 'rien de lu : rien d\'affiché');
      run(`__answers.coach_plans = { error: { code: 'PGRST202', message: 'Could not find the function public.coach_plans' } }`);
      await run('coachPlanRefresh()');
      assert.equal(run('plan.available'), false);
      assert.equal(run('planAvailable()'), false);
      assert.equal(run('localStorage.getItem(COACH_PLAN_KEY)'), null);
      // Hors ligne : rien d'affiché, rien de perdu
      run(`__answers.coach_plans = { error: { message: 'TypeError: Failed to fetch' } }; plan.available = null`);
      await run('coachPlanRefresh()');
      assert.equal(run('plan.coachError'), 'offline');
      assert.equal(run('planAvailable()'), false);
    } finally { teardown(); }
  });

  test('planification : coach, lecture puis enregistrement ; cache par compte', async () => {
    reset();
    try {
      setup();
      const phase = { id: 1, name: '', goal: 'cut', start: '2026-11-09', weeks: 6, prog_name: null, note: 'n' };
      run(`__answers.coach_plans = { students: [{ student_id: 's1', phases: [${J(phase)}] }] }`);
      await run('coachPlanRefresh()');
      sameJSON(planCalls(), ['coach_plans'], 'coach sans coach : student_plan pas appelé');
      assert.equal(run('planAvailable()'), true);
      assert.equal(run(`planOfStudent('s1')[0].note`), 'n');
      run(`__answers.coach_plan_save = a => [${J(phase)}, { id: 2, name: a.name, goal: a.goal, start: a.start_date, weeks: a.weeks, prog_name: a.programme, note: a.note }]`);
      const r = await run(`coachPlanSave('s1', { goal: 'bulk', start: '2026-12-21', weeks: 12, name: 'Masse', progName: 'PPL', note: '' })`);
      assert.equal(r.ok, true);
      sameJSON(run(`planOfStudent('s1').map(p => p.id)`), [1, 2]);
      // Erreur du serveur rendue telle quelle (texte de COACH_ERROR_TEXT)
      run(`__answers.coach_plan_save = { error: { message: 'overlap' } }`);
      assert.equal((await run(`coachPlanSave('s1', { goal: 'bulk', start: '2026-12-22', weeks: 2 })`)).kind, 'overlap');
      assert.match(run(`coachErrorText('overlap')`), /chevauche/);
      // Cache : relu pour ce compte, jamais pour un autre
      run('planReset(null); planReset("u1")');
      assert.equal(run('planAvailable()'), true);
      sameJSON(run(`planOfStudent('s1').map(p => p.id)`), [1, 2]);
      run('planReset("u2")');
      assert.equal(run('planAvailable()'), false);
      assert.equal(run(`planOfStudent('s1')`), null);
    } finally { teardown(); }
  });

  test('planification : élève, sa phase vient de son coach actuel seulement', async () => {
    reset();
    try {
      setup();
      run(`coach.state = cleanCoachState({ is_coach: false, coach: { user_id: 'c1', username: 'max', since: '2026-10-01' } })`);
      const today = run('planToday()');
      run(`__answers.student_plan = { coach: true, phases: [{ id: 3, name: 'Mini cut', goal: 'mini_cut', start: '${today}', weeks: 6, prog_name: null, note: 'jamais' }] }`);
      await run('coachPlanRefresh()');
      sameJSON(planCalls(), ['student_plan']);
      assert.equal(run('myPlan().length'), 1);
      assert.equal(run('myPlan()[0].note'), undefined, 'la note du coach n\'arrive jamais chez l\'élève');
      // Nouveau coach (cache de l'ancien) : rien tant que le serveur n'a pas répondu
      run(`coach.state = cleanCoachState({ is_coach: false, coach: { user_id: 'c2', username: 'lea', since: '2026-11-01' } })`);
      assert.equal(run('myPlan()'), null);
      // Plus de coach : oublié
      run(`coach.state = cleanCoachState({ is_coach: false, coach: null })`);
      await run('coachPlanRefresh()');
      assert.equal(run('plan.student'), null);
    } finally { teardown(); }
  });
}
