// ═══════════════════════════════════════════════════════════
//  Pas, sommeil et cardio de Santé, côté élève (docs/SANTE_COACH.md) : résumé par jour (js/data/health-days.js),
//  partage avec le coach (js/data/coach-share.js, kind 'health'), préremplissage des bilans (js/data/checkins.js,
//  js/data/checkin-student.js) et pont natif (js/platform/native.js). Lancés par tests/unit/run.mjs.
// ═══════════════════════════════════════════════════════════
export default function ({ test, run, reset, assert, sameJSON, nativeContext }) {
  // Midi local du 25/11/2026 : « aujourd'hui » des tests
  const NOW = new Date(2026, 10, 25, 12, 0).getTime();
  const at = (d, h, m = 0) => new Date(2026, 10, d, h, m).getTime();
  const build = (raw, opts = {}) => run(`healthDaysBuild(${JSON.stringify(raw)}, ${JSON.stringify({ now: NOW, ...opts })})`);

  test('santé coach : un résumé par jour, pas, sommeil de la nuit du réveil, cardio du jour', () => {
    reset();
    const out = build({
      steps: [{ day: '2026-11-25', steps: 4200 }, { day: '2026-11-24', steps: 11250 }],
      sleep: [{ start: at(24, 23), end: at(25, 6, 30), stage: 'core' }, { start: at(23, 23, 30), end: at(24, 7), stage: 'asleep' }],
      workouts: [{ start: at(24, 18), end: at(24, 18, 40), duration: 40 * 60, activity: 'running' }],
    });
    sameJSON(out, [
      { day: '2026-11-25', steps: 4200, sleep: 450, cardio: 0 },
      { day: '2026-11-24', steps: 11250, sleep: 450, cardio: 40 },
    ]);
  });

  test('santé coach : sommeil = phases « endormi » d\'iOS 16 unies, jamais le temps au lit seul ni l\'éveil', () => {
    reset();
    const out = build({ steps: [], workouts: [], sleep: [
      // Nuit du 25 : Apple Watch en phases + app de sommeil en « endormi » qui recouvre : union, pas somme
      { start: at(24, 23), end: at(25, 1), stage: 'core' }, { start: at(25, 1), end: at(25, 2), stage: 'deep' },
      { start: at(25, 2), end: at(25, 2, 20), stage: 'awake' }, { start: at(25, 2, 20), end: at(25, 6), stage: 'rem' },
      { start: at(24, 23, 30), end: at(25, 5), stage: 'asleep' }, { start: at(24, 22, 30), end: at(25, 6, 30), stage: 'inBed' },
      // Nuit du 23 : seulement « au lit » (horaires de l'iPhone) : pas une durée endormie
      { start: at(22, 23), end: at(23, 7), stage: 'inBed' },
    ] });
    sameJSON(out, [{ day: '2026-11-25', sleep: 420 }], '7 h endormi (23 h à 6 h, 20 min d\'éveil couvertes par l\'app de sommeil)');
  });

  test('santé coach : cardio uni (Apple Watch et Strava ne comptent pas deux fois), pause retirée, minute de trop écartée', () => {
    reset();
    const out = build({ steps: [{ day: '2026-11-24', steps: 9000 }], sleep: [], workouts: [
      { start: at(24, 7), end: at(24, 7, 30), duration: 1800, activity: 'running' },
      { start: at(24, 7, 2), end: at(24, 7, 31), duration: 1740, activity: 'running' },
      // 60 min de vélo dont 15 de pause : 45 min actives
      { start: at(24, 18), end: at(24, 19), duration: 2700, activity: 'cycling' },
      { start: at(24, 20), end: at(24, 20, 0) + 30_000, duration: 30, activity: 'walking' },
    ] });
    sameJSON(out, [{ day: '2026-11-24', steps: 9000, cardio: 76 }], '31 min (7 h à 7 h 31) + 45 min');
  });

  test('santé coach : lecture refusée (tout vide) → rien ; sans entraînement lu, le cardio n\'est pas un zéro inventé', () => {
    reset();
    sameJSON(build({ steps: [], sleep: [], workouts: [] }), []);
    sameJSON(build({ steps: [{ day: '2026-11-25', steps: 3000 }], sleep: [], workouts: [] }), [{ day: '2026-11-25', steps: 3000 }]);
  });

  test('santé coach : 90 jours au plus, jours futurs et dates mal formées écartés, bornes', () => {
    reset();
    const out = build({ steps: [{ day: '2026-11-26', steps: 10 }, { day: '2026-08-28', steps: 10 }, { day: '2026-08-27', steps: 10 },
      { day: 'hier', steps: 5 }, { day: '2026-11-20', steps: 250000 }, { day: '2026-11-19', steps: -3 }], sleep: [], workouts: [] });
    sameJSON(out.map(d => d.day), ['2026-11-20', '2026-08-28'], 'fenêtre : du 28/08 (J−89) à aujourd\'hui');
    assert.equal(out[0].steps, 100000, 'pas bornés à 100 000');
    const all = build({ steps: Array.from({ length: 120 }, (_, i) => ({ day: run(`healthDayShift('2026-11-25', ${-i})`), steps: 1000 + i })), sleep: [], workouts: [] });
    assert.equal(all.length, 90);
    assert.ok(Object.keys(all[0]).every(k => ['day', 'steps', 'sleep', 'cardio'].includes(k)), 'rien d\'autre que les trois nombres');
  });

  test('santé coach : résumé d\'une période de bilan (moyennes des jours qui ont une valeur, cardio en somme)', () => {
    reset();
    const list = [{ day: '2026-11-25', steps: 4000, sleep: 420, cardio: 0 }, { day: '2026-11-24', steps: 10000, cardio: 30 },
      { day: '2026-11-23', sleep: 465, cardio: 20 }, { day: '2026-11-10', steps: 99999 }];
    const keys = ['2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25'];
    sameJSON(run(`healthPeriodSummary(${JSON.stringify(list)}, ${JSON.stringify(keys)})`),
      { steps: 7000, sleepMin: 443, sleepH: 7.4, cardioMin: 50, stepDays: 2, nights: 2 });
    sameJSON(run(`healthPeriodSummary([], ${JSON.stringify(keys)})`), { steps: null, sleepMin: null, sleepH: null, cardioMin: null, stepDays: 0, nights: 0 });
  });

  test('santé coach : bilans : sommeil en heures (nombre) accepté, échelle par défaut, préremplissage seulement en nombre', () => {
    reset();
    const sleepN = run(`checkinItemClean({ kind: 'sleep', type: 'number', unit: 'min' })`);
    sameJSON(sleepN, { key: 'sleep', kind: 'sleep', label: 'Sommeil', type: 'number', required: false, unit: 'h' }, 'unité imposée par le catalogue');
    assert.equal(run(`checkinDefaultItem('sleep').type`), 'scale', 'échelle par défaut : les modèles existants ne changent pas');
    assert.equal(run(`checkinValueClean(${JSON.stringify(sleepN)}, 7.256)`), 7.26);
    assert.equal(run(`checkinValueClean(${JSON.stringify(sleepN)}, 24.5)`), undefined);
    assert.equal(run(`checkinValueText(${JSON.stringify(sleepN)}, 7.25)`), '7 h 15 par nuit');
    assert.equal(run(`checkinValueText(${JSON.stringify(sleepN)}, 0.5)`), '30 min par nuit');
    assert.equal(run(`checkinTypeText(${JSON.stringify(sleepN)})`), 'h/nuit');
    const items = run(`checkinItemsClean([{ kind: 'steps', type: 'number' }, { kind: 'cardio', type: 'number' }, { kind: 'sleep', type: 'number' }])`);
    const pre = run(`checkinPrefill(${JSON.stringify(items)}, { steps: 8123.4, sleepH: 7.4, cardioMin: 95 })`);
    sameJSON(pre, { values: { steps: 8123, cardio: 95, sleep: 7.4 }, from: { steps: 'health', cardio: 'health', sleep: 'health' } });
    const scale = run(`checkinItemsClean([{ kind: 'sleep', type: 'scale' }])`);
    sameJSON(run(`checkinPrefill(${JSON.stringify(scale)}, { sleepH: 7.4 })`), { values: {}, from: {} }, 'un ressenti ne se devine pas');
    sameJSON(run(`checkinPrefill(${JSON.stringify(items)}, {})`), { values: {}, from: {} }, 'sans Santé : à la main');
  });

  test('santé coach : contexte d\'un bilan : seulement le résumé lu pour CE bilan', () => {
    reset();
    const req = { id: '11111111-1111-4111-8111-111111111111', name: 'Hebdo', sentAt: NOW, items: [] };
    run(`ck.health = { id: '${req.id}', steps: 9000, sleepH: 7.5, cardioMin: 60 }`);
    const ctx = run(`checkinContext(${JSON.stringify(req)}, { now: ${NOW} })`);
    sameJSON([ctx.steps, ctx.sleepH, ctx.cardioMin], [9000, 7.5, 60]);
    const other = run(`checkinContext(${JSON.stringify({ ...req, id: '22222222-2222-4222-8222-222222222222' })}, { now: ${NOW} })`);
    sameJSON([other.steps, other.sleepH, other.cardioMin], [null, null, null], 'résumé d\'un autre bilan jamais repris');
    run('ck.health = null');
  });

  test('santé coach : case cachée sans la coquille qui sait lire Santé (navigateur, build antérieure)', () => {
    reset();
    run(`healthDays.supported = null`);
    assert.equal(run('healthDaysSupported()'), false, 'navigateur : jamais');
    run(`coachShare.state = cleanShareState({ coach: true, kinds: ['weight', 'measures', 'diet_log', 'health'], shares: {} })`);
    sameJSON(run('coachShareKindsShown().map(k => k.kind)'), ['weight', 'measures', 'diet_log']);
    run(`healthDays.supported = true`);
    sameJSON(run('coachShareKindsShown().map(k => k.kind)'), ['weight', 'measures', 'diet_log', 'health']);
    run(`coachShare.state = cleanShareState({ coach: true, kinds: ['weight', 'measures', 'diet_log'], shares: {} })`);
    sameJSON(run('coachShareKindsShown().map(k => k.kind)'), ['weight', 'measures', 'diet_log'], 'serveur d\'avant : pas de case');
    run(`healthDays.supported = null; coachShare.state = null`);
  });

  test('santé coach : cocher demande Santé à ce geste seulement, puis envoie ; relecture sans changement : rien ; décocher : plus rien', async () => {
    reset();
    run(`(() => {
      globalThis.__calls = []; globalThis.__on = false; globalThis.__hk = [];
      account.user = { id: 'u1' }; coachShareReset('u1'); coach.userId = 'u1';
      coach.state = cleanCoachState({ is_coach: false, coach: { user_id: 'c1', username: 'max', since: '2026-10-01' } });
      healthDays.supported = true;
      globalThis.__native = { ...Native.health };
      Object.assign(Native.health, {
        authorizeDays: async () => { __hk.push('authorize'); return true; },
        activityDays: async days => { __hk.push('activity:' + days); return { steps: [{ day: localISO(), steps: 5000 }], workouts: [] }; },
        sleep: async days => { __hk.push('sleep:' + days); return []; },
      });
      const st = () => ({ coach: true, kinds: ['weight', 'measures', 'diet_log', 'health'], shares: __on ? { health: { granted_at: '2026-11-25T10:00:00Z', n: 0, last_at: null } } : {} });
      sb = { rpc: async (fn, args) => {
        __calls.push([fn, args === undefined ? null : JSON.parse(JSON.stringify(args))]);
        if (fn === 'student_shares') return { data: st(), error: null };
        if (fn === 'student_set_share') { __on = args.enabled; return { data: st(), error: null }; }
        if (fn === 'student_share_health_days') return { data: args.days.length, error: null };
        return { data: null, error: null };
      } };
    })()`);
    const log = () => run('__calls').filter(c => c[0].startsWith('student_')).map(c => c[0]);
    try {
      await run('coachShareRefresh()');
      sameJSON(log(), ['student_shares'], 'décoché par défaut : rien lu, rien envoyé');
      sameJSON(run('__hk'), [], 'aucune autorisation demandée au lancement');
      assert.equal((await run(`coachShareSet('health', true)`)).ok, true);
      sameJSON(run('__hk'), ['authorize', 'activity:92', 'sleep:92'], 'autorisation au geste, puis lecture de 92 jours');
      sameJSON(log(), ['student_shares', 'student_set_share', 'student_share_health_days']);
      sameJSON(run('__calls').find(c => c[0] === 'student_share_health_days')[1].days, [{ day: run('localISO()'), steps: 5000 }]);
      assert.equal(run(`JSON.parse(localStorage.getItem('mdlf_coach_share_h')).coachId`), 'c1');
      // Relecture (retour au premier plan) : rien de neuf dans Santé → rien ne repart
      run('healthDays.at = 0');
      await run('coachShareRefresh()');
      assert.equal(log().filter(c => c === 'student_share_health_days').length, 1);
      // Décocher : effacé côté serveur, l'empreinte part, plus rien n'est lu ni envoyé
      await run(`coachShareSet('health', false)`);
      assert.equal(run(`localStorage.getItem('mdlf_coach_share_h')`), null);
      const before = run('__hk').length;
      sameJSON(await run('coachShareHealthSync({ force: true })'), { ok: true, skipped: true });
      assert.equal(run('__hk').length, before, 'décoché : Santé n\'est plus lue');
      assert.ok(run(`CROSS_USER_CACHE_KEYS.includes('mdlf_coach_share_h')`), 'empreinte effacée à la déconnexion');
    } finally {
      run(`Object.assign(Native.health, __native); healthDays.supported = null; healthDaysReset(); sb = null; account.user = null; coach.state = null; coachShareReset(null);
        delete globalThis.__calls; delete globalThis.__on; delete globalThis.__hk; delete globalThis.__native;`);
    }
  });

  test('santé coach : pont natif : clé days → lisible ; build antérieure, Android, navigateur → non', async () => {
    const withDays = nativeContext({ plugins: { MdlfHealth: {
      authorizationStatus: async () => ({ available: true, request: 'unnecessary', extra: 'unnecessary', days: 'shouldRequest' }),
      requestDaysAuthorization: async () => ({ available: true, asked: true }),
      activityDays: async ({ days }) => ({ steps: [{ day: '2026-11-25', steps: days }], workouts: 'pas une liste' }),
    } } });
    assert.equal(await withDays.Native.health.daysSupported(), true);
    assert.equal(await withDays.Native.health.authorizeDays(), true);
    sameJSON(await withDays.Native.health.activityDays(92), { steps: [{ day: '2026-11-25', steps: 92 }], workouts: [] });
    const old = nativeContext({ plugins: { MdlfHealth: {
      authorizationStatus: async () => ({ available: true, request: 'unnecessary', extra: 'unnecessary' }),
      activityDays: async () => { throw Object.assign(new Error('absent'), { code: 'UNIMPLEMENTED' }); },
    } } });
    assert.equal(await old.Native.health.daysSupported(), false, 'build antérieure : pas de clé days');
    assert.equal(await old.Native.health.activityDays(7), null);
    const android = nativeContext({ platform: 'android', plugins: { MdlfHealth: { authorizationStatus: async () => ({ available: true, days: 'unnecessary' }) } } });
    assert.equal(await android.Native.health.daysSupported(), false, 'Android : Health Connect ne lit pas encore les pas');
    assert.equal(await android.Native.health.authorizeDays(), false);
    const web = nativeContext({ native: false });
    assert.equal(await web.Native.health.daysSupported(), false);
    assert.equal(await web.Native.health.activityDays(7), null);
  });
}
