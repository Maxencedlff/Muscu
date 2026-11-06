// Progression des élèves (js/data/coach-progress.js) : le signal de chaque élève (inactif, en baisse, records,
// stable, la semaine), sans fausse alerte (décharge, reprise, sèche, semaines inconnues, séances d'une app
// d'avant), le tri de Mes élèves, le nettoyage de coach_progress(), les faits tirés des séances reçues, et le
// serveur sans la fonction (lecture page par page).
import fs from 'node:fs';
import path from 'node:path';

export default function ({ test, run, assert, sameJSON, ROOT }) {
  // Maintenant : mercredi 25 novembre 2026, 10 h (heure locale) ; D(k) : il y a k jours du calendrier, à 18 h
  const NOW = run('new Date(2026, 10, 25, 10).getTime()');
  const D = (k, h = 18) => run(`new Date(2026, 10, 25 - ${k}, ${h}).getTime()`);
  const J = o => JSON.stringify(o);
  const st = (o = {}) => J({ user_id: 'u', username: 'lea', since: '2026-09-01T10:00:00Z', sessions_7d: 0, new_sessions: 0, last_session: null, ...o });
  const last = k => ({ done_at: D(k), label: 'Push', programme: null });
  // Faits : séances [jours, records ?] ; records : liste notée, null (app d'avant) ou [] (aucun)
  const facts = (list, o = {}) => ({
    sessions: list.map(([k, records = []]) => ({ at: D(k), records })).sort((a, b) => b.at - a.at),
    from: -1e15, firstAt: list.length ? D(Math.max(...list.map(x => x[0]))) : null, lastRecordAt: null, unnotedAt: null, ...o,
  });
  const rec = (ex, kind = 'charge', after = 100) => ({ ex, kind, before: after - 5, after });
  const sp = (s, f = null, phases = null) => run(`studentProgress(cleanStudent(${s}), { facts: ${J(f)}, phases: ${J(phases)}, now: ${NOW} })`);
  const phase = (goal, start, weeks) => ({ id: 1, name: '', goal, start, weeks, progName: null });
  // Séances régulières : 3 par semaine sur 4 semaines (jours 1, 3, 5 de chaque semaine)
  const regular = (weeks = [3, 3, 3, 3]) => weeks.flatMap((n, w) => [1, 3, 5].slice(0, n).map(d => [7 * w + d]));

  test('progression : constantes identiques au serveur (fenêtre de 35 jours, 80 séances, horizon de 182 jours)', () => {
    const sql = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261106000000_coach_progression.sql'), 'utf8');
    assert.match(sql, /interval '35 days'/);
    assert.match(sql, /limit 80\)/);
    assert.match(sql, /interval '182 days'/);
    sameJSON([run('PROGRESS_SERVER_DAYS'), run('PROGRESS_SERVER_MAX'), run('PROGRESS_STABLE_MAX_WEEKS') * 7], [35, 80, 182]);
    assert.match(sql, /private\.session_records\(x\.data -> 'records', true\)/, 'mêmes records revalidés que coach_student_sessions');
    assert.match(sql, /grant execute on function public\.coach_progress\(\) to authenticated/);
    assert.doesNotMatch(sql, /to anon/);
  });

  test('progression : inactif à partir de 8 jours du calendrier sans séance, en semaines au-delà de 4', () => {
    assert.equal(sp(st({ last_session: last(7) })).kind, 'regular', '7 jours : pas encore');
    const p8 = sp(st({ last_session: last(8) }));
    sameJSON([p8.kind, p8.tone, p8.text, p8.daysSince], ['inactive', 'warn', '8 jours sans séance', 8]);
    assert.equal(sp(st({ last_session: last(9) })).text, '9 jours sans séance');
    assert.equal(sp(st({ last_session: last(30) })).text, '4 sem. sans séance');
    // Séance d'hier à 23 h vue à 10 h : c'est hier (jours du calendrier), pas « 0 jour »
    assert.equal(sp(st({ last_session: { done_at: D(8, 23), label: 'Push' } })).text, '8 jours sans séance');
    // Une séance plus récente dans les faits que dans coach_state (relu entre-temps) l'emporte
    assert.equal(sp(st({ last_session: last(9) }), facts([[2]])).kind, 'regular');
    // Même pendant une décharge : une semaine entière sans séance mérite un mot
    assert.equal(sp(st({ last_session: last(10) }), null, [phase('deload', '2026-11-16', 2)]).kind, 'inactive');
  });

  test('progression : chaque signal tient en 22 caractères (une ligne sur un iPhone SE)', () => {
    const texts = [sp(st({ last_session: last(27) })), sp(st({ last_session: last(200) })), sp(st({ since: new Date(D(10)).toISOString() })),
      sp(st({ last_session: last(1) }), facts([[0, Array.from({ length: 12 }, (_, i) => rec('Ex' + i))]])),
      sp(st({ last_session: last(1) }), facts([[1], ...regular([0, 9, 9, 9]).filter(x => x[0] >= 7)])),
      sp(st({ last_session: last(1) }), facts(regular(), { lastRecordAt: D(150) })), sp(st({ last_session: last(1), sessions_7d: 14 }))].map(p => p.text);
    for (const t of texts) assert.ok(t.length <= 22, `${t} : ${t.length} caractères`);
  });

  test('progression : jamais venu, « depuis son arrivée » en orange seulement après 8 jours', () => {
    const never = sp(st({ since: new Date(D(10)).toISOString() }));
    sameJSON([never.kind, never.tone, never.text], ['never', 'warn', 'Pas encore de séance']);
    const fresh = sp(st({ since: new Date(D(3)).toISOString() }));
    sameJSON([fresh.kind, fresh.tone, fresh.text], ['new', 'muted', 'Pas encore de séance']);
  });

  test('progression : records de la semaine, un par exercice, le plus marquant d\'abord', () => {
    const f = facts([[0, [rec('Squat', 'reps', 10)]], [2, [rec('Squat', 'charge', 105), rec('Tractions', 'reps', 9)]], [7, [rec('Développé couché')]], [9]]);
    const p = sp(st({ last_session: last(0) }), f);
    sameJSON([p.kind, p.tone, p.text], ['records', 'up', '2 records cette sem.'], 'Squat deux fois : un seul record ; le 7e jour d\'avant ne compte pas');
    sameJSON(p.records.map(x => [x.ex, x.r.kind]), [['Squat', 'charge'], ['Tractions', 'reps']]);
    assert.equal(p.n7, 2);
    assert.equal(sp(st({ last_session: last(0) }), facts([[0, [rec('Squat')]]])).text, '1 record cette sem.');
    // Casse et accents : même exercice
    assert.equal(sp(st({ last_session: last(0) }), facts([[0, [rec('Développé couché')]], [1, [rec('developpe COUCHE', 'reps')]]])).records.length, 1);
    // Séance d'une app d'avant (records null) : rien d'inventé
    assert.equal(sp(st({ last_session: last(0) }), facts([[0, null]])).records.length, 0);
  });

  test('progression : en baisse quand au moins 2 séances de moins que d\'habitude (médiane des 3 semaines d\'avant)', () => {
    const s = st({ last_session: last(1) });
    const f = facts([[1], ...regular([0, 3, 3, 4]).filter(x => x[0] >= 7)]);
    const p = sp(s, f);
    sameJSON([p.kind, p.tone, p.text, p.habit, p.n7], ['fewer', 'warn', '1 séance au lieu de 3', 3, 1]);
    // Une seule séance de moins : rien (une séance ratée n'est pas une baisse)
    assert.notEqual(sp(s, facts([[1], [3], ...regular([0, 3, 3, 3]).filter(x => x[0] >= 7)])).tone, 'warn');
    // Une semaine à part (malade) ne fausse pas l'habitude : médiane de 0, 3, 3 = 3
    assert.equal(sp(s, facts([[1], ...regular([0, 0, 3, 3]).filter(x => x[0] >= 7)])).habit, 3);
    // Une fois par semaine : jamais « en baisse » (l'inactivité suffit)
    assert.notEqual(sp(st({ last_session: last(7) }), facts([[7], [14], [21], [27]])).tone, 'warn');
    // Records et baisse : la baisse d'abord (le coach doit le savoir)
    assert.equal(sp(s, facts([[1, [rec('Squat')]], ...regular([0, 3, 3, 3]).filter(x => x[0] >= 7)])).kind, 'fewer');
  });

  test('progression : jamais « en baisse » pendant une décharge ou une reprise, ni juste après', () => {
    const s = st({ last_session: last(1) });
    const f = facts([[1], ...regular([0, 3, 3, 3]).filter(x => x[0] >= 7)]);
    assert.notEqual(sp(s, f, [phase('deload', '2026-11-23', 1)]).tone, 'warn', 'décharge en cours');
    assert.notEqual(sp(s, f, [phase('comeback', '2026-11-02', 4)]).tone, 'warn', 'reprise en cours');
    // Décharge finie avant-hier : la semaine glissante la contient encore
    assert.notEqual(sp(s, f, [phase('deload', '2026-11-16', 1)]).tone, 'warn', 'décharge du 16 au 22 nov.');
    // Décharge finie il y a 8 jours : plus d'effet
    assert.equal(sp(s, f, [phase('deload', '2026-11-09', 1)]).kind, 'fewer', 'décharge du 9 au 15 nov.');
    // Décharge à venir : aucun effet
    assert.equal(sp(s, f, [phase('deload', '2026-11-30', 1)]).kind, 'fewer');
    // Sèche : on s'entraîne autant, la baisse reste signalée
    assert.equal(sp(s, f, [phase('cut', '2026-11-02', 6)]).kind, 'fewer');
  });

  test('progression : habitude seulement si les 3 semaines d\'avant sont connues', () => {
    const s = st({ last_session: last(1) });
    const list = [[1], ...regular([0, 3, 3, 3]).filter(x => x[0] >= 7)];
    // Séances reçues jusqu'à il y a 20 jours seulement (page incomplète) : on ne sait pas
    assert.equal(sp(s, facts(list, { from: D(20, 0) })).habit, null);
    assert.notEqual(sp(s, facts(list, { from: D(20, 0) })).tone, 'warn');
    // Jusqu'au début du 27e jour d'avant : connues
    assert.equal(sp(s, facts(list, { from: D(27, 0) })).kind, 'fewer');
    // Sans faits du tout : séances sur 7 jours de coach_state, ni habitude ni records
    const p = sp(st({ last_session: last(1), sessions_7d: 3 }));
    sameJSON([p.kind, p.text, p.habit, p.records.length], ['regular', '3 séances cette sem.', null, 0]);
  });

  test('progression : stable depuis 2 semaines sans record, seulement sur des séances que l\'app sait juger', () => {
    const s = st({ last_session: last(1) });
    const f = o => facts(regular(), o);
    const p = sp(s, f({ lastRecordAt: D(20) }));
    sameJSON([p.kind, p.tone, p.text], ['stable', 'muted', 'Stable depuis 2 sem.']);
    assert.equal(sp(s, f({ lastRecordAt: D(13) })).kind, 'regular', '13 jours : pas encore');
    assert.equal(sp(s, f({ lastRecordAt: D(22) })).text, 'Stable depuis 3 sem.');
    // Jamais de record : depuis la première séance connue
    assert.equal(sp(s, f({ lastRecordAt: null, firstAt: D(30) })).text, 'Stable depuis 4 sem.');
    assert.equal(sp(s, f({ lastRecordAt: null, firstAt: D(181) })).text, 'Stable depuis 25 sem.');
    assert.equal(sp(s, f({ lastRecordAt: null, firstAt: D(185) })).text, 'Stable depuis 6 mois');
    // Une séance sans records notés (app d'avant) il y a 5 jours : on ne juge que depuis, donc pas « stable »
    assert.equal(sp(s, f({ lastRecordAt: D(40), unnotedAt: D(5) })).kind, 'regular');
    // Phase où un record n'est pas le but : jamais « stable »
    for (const goal of ['cut', 'mini_cut', 'maintain', 'deload', 'comeback']) {
      assert.equal(sp(s, f({ lastRecordAt: D(40) }), [phase(goal, '2026-11-09', 6)]).kind, 'regular', goal);
    }
    assert.equal(sp(s, f({ lastRecordAt: D(40) }), [phase('bulk', '2026-11-09', 6)]).kind, 'stable', 'prise de masse : oui');
    // Aucune séance cette semaine (mais moins de 8 jours) : la semaine, pas « stable »
    assert.equal(sp(st({ last_session: last(7) }), facts([[7], [14]], { lastRecordAt: D(40) })).text, '0 séance cette sem.');
  });

  test('progression : tri de Mes élèves (nouveautés, à relancer, records, les autres)', () => {
    const order = run(`(() => {
      const now = ${NOW}, D = k => new Date(2026, 10, 25 - k, 18).getTime();
      const mk = (name, o) => cleanStudent({ user_id: name, username: name, since: '2026-09-01T10:00:00Z', sessions_7d: 2, ...o });
      const L = k => ({ done_at: D(k), label: 'Push' });
      const F = recs => ({ sessions: [{ at: D(1), records: recs }], from: -1e15, firstAt: D(1), lastRecordAt: null, unnotedAt: null });
      const R = n => Array.from({ length: n }, (_, i) => ({ ex: 'Ex' + i, kind: 'charge', before: 1, after: 2 }));
      const list = [
        [mk('fanny', { last_session: L(1) }), F([])],
        [mk('dora', { last_session: L(1) }), F(R(1))],
        [mk('chloe', { last_session: L(9) }), null],
        [mk('anna', { last_session: L(0), new_sessions: 2 }), F(R(2))],
        [mk('bob', { last_session: L(12) }), null],
        [mk('eva', { last_session: L(1) }), F(R(3))],
        [mk('gus', { last_session: L(2) }), F([])],
        [mk('hugo', { last_session: L(3) }), F([])],
      ];
      const facts = new Map(list.map(([s, f]) => [s.user_id, f]));
      return sortStudentsByProgress(list.map(x => x[0]), s => studentProgress(s, { facts: facts.get(s.user_id), now }), s => (s.user_id === 'gus' ? 1 : 0))
        .map(x => x.st.user_id + ':' + x.rank);
    })()`);
    sameJSON(order, ['anna:0', 'gus:0', 'bob:1', 'chloe:1', 'eva:2', 'dora:2', 'fanny:3', 'hugo:3']);
  });

  test('progression : coach_progress() nettoyé (records revalidés, fenêtre, entrées inutilisables)', () => {
    const at = NOW;
    const out = run(`cleanCoachProgress(${J({ students: [
      { student_id: 'a', first_at: D(50), last_record_at: D(2), unnoted_at: 'x', sessions: [
        { at: D(5), records: null },
        { at: D(2), records: [rec('Squat'), { ex: 'Presse', kind: '1rm', before: 1, after: 2 }, { ex: '', kind: 'charge', before: 1, after: 2 }] },
        { at: 'hier', records: [] }, null] },
      { student_id: 'b', sessions: Array.from({ length: 90 }, (_, i) => ({ at: D(0) - i * 3_600_000, records: [] })) },
      { student_id: '', sessions: [] }, { student_id: 'c' }, 'x', null,
    ] })}, ${at})`);
    sameJSON(Object.keys(out), ['a', 'b']);
    sameJSON(out.a.sessions.map(s => s.at), [D(2), D(5)], 'du plus récent, sans date invalide');
    sameJSON(out.a.sessions[0].records.map(r => r.ex), ['Squat'], 'type inconnu et nom vide écartés');
    assert.equal(out.a.sessions[1].records, null, 'app d\'avant : null');
    sameJSON([out.a.firstAt, out.a.lastRecordAt, out.a.unnotedAt, out.a.from], [D(50), D(2), null, at - 35 * 86_400_000]);
    assert.equal(out.b.sessions.length, 80, '80 séances au plus');
    assert.equal(out.b.from, out.b.sessions[79].at, 'fenêtre pleine : couverte jusqu\'à la plus ancienne reçue');
    sameJSON(run('cleanCoachProgress(null, 0)'), {});
  });

  test('progression : faits tirés des séances reçues (serveur sans coach_progress)', () => {
    const rows = [
      { id: 'a', doneAt: D(1), s: { records: [rec('Squat')] } },
      { id: 'b', doneAt: D(4), s: {} },
      { id: 'c', doneAt: D(9), s: { records: [] } },
    ];
    const f = run(`progressFactsFromRows(${J({ rows, end: false, loadedAt: 1 })})`);
    sameJSON([f.from, f.firstAt, f.lastRecordAt, f.unnotedAt], [D(9), D(9), D(1), D(4)]);
    assert.equal(f.sessions[1].records, null, 'séance d\'une app d\'avant');
    assert.equal(run(`progressFactsFromRows(${J({ rows, end: true, loadedAt: 1 })}).from`), -Infinity, 'tout l\'historique reçu');
    assert.equal(run(`progressFactsFromRows(${J({ rows: [], end: false, loadedAt: 0 })})`), null, 'rien de lu');
  });

  test('progression : lecture du serveur, puis séances page par page si la fonction manque', async () => {
    run(`(() => {
      globalThis.__calls = [];
      globalThis.__answers = {};
      account.user = { id: 'k1' };
      progressReset('k1');
      coach.userId = 'k1';
      coach.sessions = {};
      const D = k => Date.now() - k * 86400000;
      coach.state = cleanCoachState({ is_coach: true, coach: null, students: [
        { user_id: 's1', username: 'lea', since: '2026-10-01', last_session: { done_at: D(1), label: 'Push' } },
        { user_id: 's2', username: 'tom', since: '2026-10-01', last_session: { done_at: D(60), label: 'Legs' } },
        { user_id: 's3', username: 'zoe', since: '2026-10-01' }] });
      sb = { rpc: async (fn, args) => {
        __calls.push([fn, args === undefined ? null : JSON.parse(JSON.stringify(args))]);
        const a = __answers[fn];
        const v = typeof a === 'function' ? a(args) : a;
        return v && v.error ? { data: null, error: v.error } : { data: v ?? null, error: null };
      } };
    })()`);
    try {
      run(`__answers.coach_progress = { students: [{ student_id: 's1', sessions: [{ at: Date.now() - 3600000, records: [{ ex: 'Squat', kind: 'charge', before: 100, after: 105 }] }] }] }`);
      assert.equal(await run('coachProgressRefresh()'), true);
      assert.equal(run('progress.available'), true);
      assert.equal(run(`coachStudentProgress(coach.state.students[0]).text`), '1 record cette sem.');
      assert.equal(await run('coachProgressRefresh()'), true, 'relu il y a moins de 5 min : rien');
      assert.equal(run('__calls.filter(c => c[0] === "coach_progress").length'), 1);
      // Serveur d'avant : PGRST202 → séances de l'élève actif ces 35 jours (Léa), pas de Tom ni de Zoé
      run(`progressReset('k1'); __calls.length = 0;
        __answers.coach_progress = { error: { code: 'PGRST202', message: 'Could not find the function public.coach_progress' } };
        __answers.coach_student_sessions = [{ id: 'x1', done_at: Date.now() - 3600000, s: { date: Date.now() - 3600000, label: 'Push', exercises: [], records: [{ ex: 'Rowing', kind: 'reps', before: 8, after: 9, w: 60 }] }, note: null }];`);
      assert.equal(await run('coachProgressRefresh()'), false);
      for (let i = 0; i < 5 && run('progress.prefetching'); i++) await new Promise(r => setTimeout(r, 0));
      assert.equal(run('progress.available'), false);
      sameJSON(run('__calls.map(c => c[0] + (c[1]?.student ? ":" + c[1].student : ""))'), ['coach_progress', 'coach_student_sessions:s1']);
      assert.equal(run(`coachStudentProgress(coach.state.students[0]).text`), '1 record cette sem.', 'signal depuis les séances reçues');
      // Ensuite : plus d'appel à la fonction absente ; séances lues il y a moins de 5 min : pas relues
      await run('coachProgressRefresh()');
      for (let i = 0; i < 5 && run('progress.prefetching'); i++) await new Promise(r => setTimeout(r, 0));
      assert.equal(run('__calls.length'), 2);
      // Changement de compte : tout repart de zéro
      run(`account.user = { id: 'k2' }; progressReset('k2');`);
      sameJSON([run('progress.available'), run('progress.facts')], [null, null]);
    } finally {
      run('sb = null; account.user = null; coach.state = null; coach.sessions = {}; progressReset(null); delete globalThis.__calls; delete globalThis.__answers;');
    }
  });
}
