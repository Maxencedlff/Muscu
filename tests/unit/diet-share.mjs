// Suivi de la diète par le coach (js/data/diet-share.js, migration 20261118010000_suivi_diete_coach.sql) : ce qui part
// (un résumé par jour, jamais les aliments), sur quelle fenêtre (90 jours), quand (case cochée sur le serveur, résumé
// changé), statut d'un jour par seuils d'écart, « À relancer », nettoyage de ce que rend le serveur.
import fs from 'node:fs';
import path from 'node:path';

export default function ({ test, run, reset, assert, sameJSON, ROOT }) {
  const j = v => JSON.stringify(v);
  const NOW = new Date(2026, 10, 18, 12, 30).getTime();   // mercredi 18 novembre 2026, 12 h 30
  const TODAY = '2026-11-18', D1 = '2026-11-17', D2 = '2026-11-16', D3 = '2026-11-15';
  const it = (id, name, g, k, p, c, f, s) => ({ id, name, food: null, fam: 'f', g, per: { k, p, c, f, s }, src: 'perso' });
  // Plan du coach : 2 000 kcal prévues sur 2 300 visées ; eau 3 à 5 L ; sel 3 à 5 g
  const PLAN = { name: 'Sèche semaine 1', fromCoach: { coachId: 'c1', name: 'max', sentAt: 1 },
    targets: { kcal: 2300, p: 150, c: 270, f: 55, water: 5, waterMin: 3, saltMin: 3, saltMax: 5 },
    meals: [
      { id: 'm1', name: 'Petit-déjeuner', items: [it('i1', 'Flocons d\'avoine secret', 100, 400, 12, 60, 8, 0.1)] },
      { id: 'm2', name: 'Déjeuner', items: [it('i2', 'Riz cuit', 300, 150, 3, 33, 0.5, 0.05), it('i3', 'Poulet', 200, 120, 26, 0, 2, 0.2)] },
      { id: 'm3', name: 'Dîner', items: [it('i4', 'Pâtes cuites', 300, 150, 5, 30, 1, 0.1)] },
    ] };
  const setPlan = () => run(`data.dietPlans = { d_seche1: ${j(PLAN)} }; data.dietActive = 'd_seche1';`);
  const day = d => run(`dietShareDay(data, ${j(d)}, ${j(TODAY)})`);

  test('suivi diète : résumé d\'un jour, jamais les aliments ni les heures', () => {
    reset(); setPlan();
    run(`data.dietLog = { ${j(TODAY)}: { plan: 'd_seche1', done: ['m1', 'm2'], swaps: {}, meals: ['m1', 'm2', 'm3'] } }`);
    run(`data.waterLog = { ${j(TODAY)}: [{ id: 'a', ml: 1500, at: ${NOW} }, { id: 'b', ml: 750, at: ${NOW} }] }`);
    run(`data.saltLog = { ${j(TODAY)}: [{ id: 's', g: 0.35, at: ${NOW} }] }`);
    const x = day(TODAY);
    sameJSON(Object.keys(x), ['day', 'plan', 'name', 'kind', 'meals', 'kcal', 'p', 'c', 'f', 'goal', 'water', 'waterGoal', 'waterMin', 'salt', 'saltMin', 'saltMax']);
    sameJSON(x.meals, [{ n: 'Petit-déjeuner', ok: true }, { n: 'Déjeuner', ok: true }, { n: 'Dîner', ok: false }]);
    assert.equal(x.kcal, 400 + 450 + 240, 'mangé : repas cochés seulement');
    sameJSON([x.p, x.c, x.f], [12 + 9 + 52, 60 + 99, 8 + 1.5 + 4].map(Math.round));
    sameJSON(x.goal, { kcal: 2300, p: 150, c: 270, f: 55 });
    sameJSON([x.water, x.waterGoal, x.waterMin], [2250, 5000, 3000]);
    sameJSON([x.salt, x.saltMin, x.saltMax], [1, 3, 5], 'sel des aliments mangés + sel ajouté');
    assert.equal(x.kind, null, 'plan d\'un seul jour : pas de type de jour');
    assert.ok(!JSON.stringify(x).includes('Flocons') && !JSON.stringify(x).includes('Riz') && !JSON.stringify(x).includes(String(NOW)), 'ni aliment ni heure');
    // Jour d'entraînement / repos du plan
    run(`data.dietPlans.d_seche1.days = { mode: 'session', more: [{ meals: ${j(PLAN.meals.slice(0, 2))} }] }`);
    run(`data.dietLog[${j(TODAY)}].kind = 'r'`);
    assert.equal(day(TODAY).kind, 'r');
  });

  test('suivi diète : fenêtre de 90 jours, seulement les jours notés sur l\'appareil (jamais le plan suivi seul)', () => {
    reset(); setPlan();
    const old = new Date(NOW); old.setDate(old.getDate() - 95);
    const d89 = new Date(NOW); d89.setDate(d89.getDate() - 89);
    const k = t => run(`dietDayKey(${t.getTime()})`);
    run(`data.dietLog = { ${j(k(old))}: { plan: 'd_seche1', done: ['m1'], swaps: {} }, ${j(k(d89))}: { plan: 'd_seche1', done: ['m1'], swaps: {} }, ${j(D2)}: { plan: 'd_seche1', done: ['m3'], swaps: {} } }`);
    run(`data.waterLog = { ${j(D3)}: [{ id: 'a', ml: 500, at: 1 }] }`);
    const p = run(`dietSharePayload(data, ${NOW})`);
    sameJSON(p.map(x => x.day), [D2, D3, k(d89)], 'du plus récent ; 95 jours : pas envoyé ; aujourd\'hui sans rien de noté : pas envoyé');
    sameJSON([p[1].plan, p[1].water, p[1].meals], [null, 500, []], 'jour sans plan noté : l\'eau seule');
    // Aujourd'hui, de l'eau notée sans journal : le résumé prend le plan suivi
    run(`data.waterLog[${j(TODAY)}] = [{ id: 'w', ml: 250, at: 1 }]`);
    const t = run(`dietSharePayload(data, ${NOW})`)[0];
    sameJSON([t.day, t.plan, t.water], [TODAY, 'd_seche1', 250]);
    // Sans plan, sans eau ni sel : rien
    run('data.dietActive = null; data.dietLog = {}; data.waterLog = {};');
    sameJSON(run(`dietSharePayload(data, ${NOW})`), []);
  });

  test('suivi diète : statut par seuils d\'écart (10 % suivi, 25 % partiel), repas cochés sans objectif', () => {
    const x = (kcal, goal, meals = []) => ({ kcal, goal: goal === null ? null : { kcal: goal }, meals });
    const st = (v, o) => run(`dietShareStatus(${j(v)}, ${j(o || {})})`);
    assert.equal(st(x(2070, 2300)), 'ok', '−10 %');
    assert.equal(st(x(2530, 2300)), 'ok', '+10 %');
    assert.equal(st(x(2000, 2300)), 'part', '−13 %');
    assert.equal(st(x(1725, 2300)), 'part', '−25 %');
    assert.equal(st(x(1700, 2300)), 'off', '−26 %');
    assert.equal(st(x(0, 2300)), 'off');
    assert.equal(st(null), 'none');
    assert.equal(st(null, { today: true }), 'today');
    assert.equal(st(x(900, 2300), { today: true }), 'today', 'aujourd\'hui pas fini : en cours, jamais « pas suivi »');
    assert.equal(st(x(2300, 2300), { today: true }), 'ok');
    assert.equal(st(x(500, null, [{ ok: true }, { ok: true }])), 'ok', 'sans objectif : tous les repas cochés');
    assert.equal(st(x(500, null, [{ ok: true }, { ok: false }])), 'part');
    assert.equal(st(x(0, null, [{ ok: false }])), 'off');
    assert.equal(run(`dietShareGap(${j(x(1840, 2300))})`), -20);
    // Protéines : des calories justes sans les protéines ne font qu'un jour partiel ; au-dessus ne compte pas contre
    assert.equal(st({ kcal: 2300, p: 100, goal: { kcal: 2300, p: 150 }, meals: [] }), 'part');
    assert.equal(st({ kcal: 2300, p: 135, goal: { kcal: 2300, p: 150 }, meals: [] }), 'ok', '90 % des protéines');
    assert.equal(st({ kcal: 2300, p: 220, goal: { kcal: 2300, p: 150 }, meals: [] }), 'ok');
  });

  test('suivi diète : « À relancer » après 3 jours pas suivis, jamais avant le partage', () => {
    const since = new Date(2026, 10, 1).getTime();
    const off = { kcal: 500, goal: { kcal: 2300 }, meals: [] }, ok = { kcal: 2300, goal: { kcal: 2300 }, meals: [] };
    const warn = (ov) => run(`dietShareWarn(${j(ov)}, ${NOW})`);
    assert.equal(warn({ since, days: { [D1]: off, [D2]: off, [D3]: off } }), true);
    assert.equal(warn({ since, days: {} }), true, 'rien de noté 3 jours : à relancer');
    assert.equal(warn({ since, days: { [D1]: off, [D2]: ok, [D3]: off } }), false);
    assert.equal(warn({ since, days: { [TODAY]: off, [D1]: ok } }), false, 'aujourd\'hui ne compte pas');
    assert.equal(warn({ since: new Date(2026, 10, 16).getTime(), days: {} }), false, 'partagé depuis 2 jours : pas encore');
    assert.equal(warn(null), false, 'ne partage pas : jamais');
    assert.ok(run('DIET_SHARE_WARN_TEXT.length') <= 24, 'signal d\'une ligne sur iPhone SE');
  });

  test('suivi diète : ce que rend le serveur est nettoyé', () => {
    const r = run(`cleanCoachDiet({ shared: true, since: '2026-11-01T10:00:00Z', days: [
      { day: '2026-11-18', plan: 'd_x', name: 'Sèche', kind: 'z', meals: [{ n: 'Dîner', ok: true }, { x: 1 }, 'a'], kcal: 99999, p: 10, c: 'a', f: 5, goal: { kcal: 2300 }, water: 1500 },
      { day: 'x' }, null] })`);
    sameJSON(Object.keys(r.days), ['2026-11-18']);
    const d = r.days['2026-11-18'];
    sameJSON([d.kind, d.meals, d.kcal, d.c, d.goal.kcal, d.water, d.salt], [null, [{ n: 'Dîner', ok: true }], 20000, 0, 2300, 1500, null]);
    sameJSON(run(`cleanCoachDiet({ shared: false, days: [{ day: '2026-11-18', kcal: 1 }] })`), { shared: false, since: null, days: {} });
    const ov = run(`cleanDietOverview({ students: [{ student_id: 'u2', since: '2026-11-01T10:00:00Z', days: [['2026-11-17', 1800, 2300, 2, 3], ['bad']] }, { x: 1 }] })`);
    sameJSON(Object.keys(ov), ['u2']);
    sameJSON(ov.u2.days['2026-11-17'], { kcal: 1800, goal: { kcal: 2300, p: 0 }, p: 0, meals: [{ ok: true }, { ok: true }, { ok: false }] });
    const ov2 = run(`cleanDietOverview({ students: [{ student_id: 'u3', since: '2026-11-01T10:00:00Z', days: [['2026-11-18', 2300, 2300, 4, 4, 150, 150], ['2026-11-17', 2300, 2300, 4, 4, 100, 150], ['2026-11-16', 2250, 2300, 4, 4, 140, 150]] }] })`);
    assert.equal(run(`dietShareWeekCount(${j(ov2.u3)}, ${new Date(2026, 10, 18, 12, 30).getTime()})`), 2, 'jours suivis sur 7 : aujourd\'hui compris s\'il est suivi, protéines comprises');
    assert.equal(run('dietShareWeekCount(null)'), null);
    sameJSON(run(`dietShareWeekDays(0, ${NOW})`), ['2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18']);
    sameJSON(run(`dietShareWeekDays(1, ${NOW})`)[6], '2026-11-11');
  });

  test('suivi diète : rien ne part sans la case cochée ; cocher envoie, puis seulement si le résumé change', async () => {
    reset(); setPlan();
    run(`(() => {
      globalThis.__calls = [];
      account.user = { id: 'u1' };
      coachShareReset('u1');
      coach.userId = 'u1';
      coach.state = cleanCoachState({ is_coach: false, coach: { user_id: 'c1', username: 'max', since: '2026-10-01' } });
      globalThis.__on = false;
      sb = { rpc: async (fn, args) => {
        __calls.push([fn, args === undefined ? null : JSON.parse(JSON.stringify(args))]);
        const kinds = ['weight', 'measures', 'diet', 'diet_log'];
        if (fn === 'student_shares') return { data: { coach: true, kinds, shares: __on ? { diet_log: { granted_at: '2026-11-18T10:00:00Z', n: 0, last_at: null } } : {} }, error: null };
        if (fn === 'student_set_share') { __on = args.enabled; return { data: { coach: true, kinds, shares: __on ? { diet_log: { granted_at: '2026-11-18T10:00:00Z', n: 0, last_at: null } } : {} }, error: null }; }
        if (fn === 'student_share_diet_days') return { data: args.days.length, error: null };
        return { data: null, error: null };
      } };
    })()`);
    const log = () => run('__calls').filter(c => c[0].startsWith('student_')).map(c => c[0]);
    try {
      await run('coachShareRefresh()');
      sameJSON(log(), ['student_shares'], 'décoché par défaut : rien envoyé');
      sameJSON(run('coachShareKindsShown().map(k => k.kind)'), ['weight', 'measures', 'diet_log']);
      run('dietShareSchedule()');
      assert.equal(run('dietShareTimer'), 0, 'pas partagé : aucun envoi prévu');
      run(`data.dietLog = { ${j(TODAY)}: { plan: 'd_seche1', done: [], swaps: {} } }`);   // journal du jour sur cet appareil
      assert.equal((await run(`coachShareSet('diet_log', true)`)).ok, true);
      sameJSON(log(), ['student_shares', 'student_set_share', 'student_share_diet_days']);
      const sent = run('__calls').find(c => c[0] === 'student_share_diet_days')[1].days;
      assert.ok(sent.length >= 1 && sent[0].plan === 'd_seche1');
      // Même résumé : rien ne repart ; une coche : il repart
      sameJSON(await run(`coachShareUploadKind('diet_log', { force: true, ifChanged: true })`), { ok: true, skipped: true });
      run(`dietToggleMeal(data, 'd_seche1', 'm1')`);
      await run(`coachShareUploadKind('diet_log', { force: true, ifChanged: true })`);
      assert.equal(log().filter(c => c === 'student_share_diet_days').length, 2);
      // Décocher : plus rien ne part
      await run(`coachShareSet('diet_log', false)`);
      sameJSON(await run(`coachShareUploadKind('diet_log', { force: true })`), { ok: true, skipped: true });
    } finally {
      run('clearTimeout(dietShareTimer); sb = null; account.user = null; coach.state = null; coachShareReset(null); delete globalThis.__calls; delete globalThis.__on;');
    }
  });

  test('suivi diète : deuxième appareil (audit du 19/11) : sans journal il n\'envoie rien ; save() n\'envoie plus ; deux appareils s\'additionnent', async () => {
    reset(); setPlan();
    // Faux serveur qui fusionne jour par jour, comme la migration (insert … on conflict update)
    run(`(() => {
      globalThis.__srv = {}; globalThis.__calls = [];
      account.user = { id: 'u1' }; coachShareReset('u1'); coach.userId = 'u1';
      coach.state = cleanCoachState({ is_coach: false, coach: { user_id: 'c1', username: 'max', since: '2026-10-01' } });
      coachShare.state = cleanShareState({ coach: true, kinds: ['weight', 'measures', 'diet', 'diet_log'], shares: { diet_log: { granted_at: '2026-11-01T10:00:00Z', n: 0, last_at: null } } });
      sb = { rpc: async (fn, args) => { __calls.push(fn);
        if (fn === 'student_share_diet_days') { for (const x of args.days) __srv[x.day] = x; return { data: Object.keys(__srv).length, error: null }; }
        return { data: null, error: null }; } };
    })()`);
    try {
      // Appareil B : plan suivi synchronisé, aucun journal local
      run('data.dietLog = {}; data.waterLog = {}; data.saltLog = {}; clearTimeout(dietShareTimer); dietShareTimer = 0;');
      run('save()');
      assert.equal(run('dietShareTimer'), 0, 'save() sans geste de diète : aucun envoi prévu');
      sameJSON(run(`dietSharePayload(data, ${NOW})`), [], 'B sans journal : rien à envoyer');
      // Appareil A a envoyé deux jours ; B n'efface rien en envoyant sa liste (vide : pas d'envoi du tout)
      run(`__srv[${j(D1)}] = { day: ${j(D1)}, kcal: 2100 }; __srv[${j(D2)}] = { day: ${j(D2)}, kcal: 2000 };`);
      await run(`coachShareUploadKind('diet_log', { force: true, ifChanged: true })`);
      sameJSON(Object.keys(run('__srv')).sort(), [D2, D1], 'les jours de A restent');
      // B coche un repas aujourd'hui : le geste prévoit l'envoi ; le serveur additionne
      run(`dietToggleMeal(data, 'd_seche1', 'm1', ${j(TODAY)})`);
      assert.ok(run('dietShareTimer'), 'coche : envoi prévu');
      run('clearTimeout(dietShareTimer); dietShareTimer = 0;');
      await run(`coachShareUploadKind('diet_log', { force: true, ifChanged: true })`);
      sameJSON(Object.keys(run('__srv')).sort(), [D2, D1, TODAY], 'A et B s\'additionnent');
      assert.equal(run('coachShare.state.shares.diet_log.n'), 3, 'le nombre vu par le coach : tous les jours gardés');
    } finally {
      run('clearTimeout(dietShareTimer); sb = null; account.user = null; coach.state = null; coachShareReset(null); delete globalThis.__srv; delete globalThis.__calls;');
    }
  });

  test('synchronisation : un plan reçu sans days (vieil appareil) garde les jours du plan local', () => {
    reset();
    const week = { mode: 'week', kinds: ['t', 'r', 't', 't', 't', 'r', 'r'], more: [] };
    const local = { dietConsent: { on: true, at: '2026-11-01T10:00:00.000Z' }, dietPlans: { d_a: { ...PLAN, days: week } } };
    const remote = { dietConsent: { on: true, at: '2026-11-01T10:00:00.000Z' }, dietPlans: { d_a: { ...PLAN, name: 'Renommé' } } };
    const out = run(`(() => { const d = {}; mergeDietProfile(d, ${j(local)}, ${j(remote)}, true); return d.dietPlans.d_a; })()`);
    assert.equal(out.name, 'Renommé', 'le reste du plan reçu est pris');
    sameJSON(out.days?.kinds, week.kinds, 'days du plan local gardé');
  });

  test('suivi diète : app et serveur d\'accord (donnée, 90 jours, seuils documentés)', () => {
    const sql = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261118010000_suivi_diete_coach.sql'), 'utf8');
    assert.match(sql, /\$\$ select kind in \('weight', 'measures', 'diet', 'diet_log'\) \$\$/);
    assert.match(sql, /now\(\) at time zone 'utc'\)::date - 89 \$\$/, '90 jours, aujourd\'hui compris');
    assert.equal(run('DIET_SHARE_DAYS'), 90);
    assert.ok(run('DIET_SHARE_WEEKS * 7') <= 90, 'semaines remontées par le coach : sous les 90 jours gardés');
    const doc = fs.readFileSync(path.join(ROOT, 'docs/NUTRITION_V1.md'), 'utf8');
    assert.match(doc, /Suivi de la diète par le coach/);
    const privacy = fs.readFileSync(path.join(ROOT, 'privacy.html'), 'utf8');
    assert.match(privacy, /Suivi de ma diète/);
    assert.match(privacy, /90 (derniers )?jours/);
  });
}
