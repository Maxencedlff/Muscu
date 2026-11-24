// Défis (docs/DEFIS.md, js/data/defis.js, js/features/defis-ui.js) : jours, séries, minuit, pauses, fusion de la synchro,
// export CSV, récaps, rappels. Les heures sont construites dans le contexte de l'app (new Date(a, m, j, h, mi) : heure
// locale, quel que soit le fuseau de la machine qui lance les tests).
export default function ({ test, run, reset, assert, sameJSON }) {
  const T = (y, m, d, h = 12, mi = 0) => run(`new Date(${y}, ${m - 1}, ${d}, ${h}, ${mi}).getTime()`);
  const j = v => JSON.stringify(v);
  // Défi « Pompes » 100 par jour, lancé le 1er novembre 2026 à 9 h
  const make = (extra = {}) => {
    reset();
    const now = T(2026, 11, 1, 9);
    const r = run(`defiCreate(data, ${j({ name: 'Pompes', goal: 100, length: 30, ...extra })}, ${now})`);
    assert.equal(r.ok, true);
    return r.id;
  };

  test('défis : création bornée (nom, objectif, 4 au plus) et nettoyage', () => {
    reset();
    const now = T(2026, 11, 1);
    assert.equal(run(`defiCreate(data, { name: '  ', goal: 10 }, ${now}).error`), 'name');
    assert.equal(run(`defiCreate(data, { name: 'Pompes', goal: 0 }, ${now}).error`), 'goal');
    assert.equal(run(`defiCreate(data, { name: 'Pompes', goal: 2001 }, ${now}).error`), 'goal');
    for (let i = 0; i < 4; i++) assert.equal(run(`defiCreate(data, { name: 'D${i}', goal: 10 }, ${now}).ok`), true);
    assert.equal(run(`defiCreate(data, { name: 'D5', goal: 10 }, ${now}).error`), 'full', '4 défis au plus');
    run(`data.defis.zz = { name: '<b>', goals: 'x' }; data.defis['bad id!'] = { name: 'x' }; sanitizeData(data)`);
    assert.equal(run('Object.keys(data.defis).length'), 4, 'défis illisibles retirés');
    run('data.defisRecapOff = "non"; sanitizeData(data)');
    assert.equal(run('data.defisRecapOff'), undefined);
  });

  test('défis : noter en plusieurs fois, total du jour, Annuler', () => {
    const id = make();
    const a = run(`defiAdd(data, '${id}', 30, '2026-11-01', ${T(2026, 11, 1, 8)})`);
    run(`defiAdd(data, '${id}', 40, '2026-11-01', ${T(2026, 11, 1, 12)})`);
    run(`defiAdd(data, '${id}', 30, '2026-11-01', ${T(2026, 11, 1, 19)})`);
    assert.equal(run(`defiDayTotal(data.defis['${id}'], '2026-11-01')`), 100);
    assert.equal(run(`defiDayState(data.defis['${id}'], '2026-11-01', '2026-11-01')`), 'done');
    assert.equal(run(`defiUndo(data, '${id}', '2026-11-01', '${a.entry.id}')`), true);
    assert.equal(run(`defiDayTotal(data.defis['${id}'], '2026-11-01')`), 70);
    assert.equal(run(`data.defis['${id}'].gone.includes('${a.entry.id}')`), true, 'ajout annulé gardé dans gone');
    assert.equal(run(`defiAdd(data, '${id}', 10, '2026-11-09', ${T(2026, 11, 2)})`), null, 'jamais un jour à venir');
    assert.equal(run(`defiAdd(data, '${id}', 10, '2026-10-31', ${T(2026, 11, 2)})`), null, 'jamais avant le début');
    assert.equal(run(`defiAdd(data, '${id}', 0, '2026-11-01', ${T(2026, 11, 2)})`), null);
    assert.equal(run(`defiAdd(data, '${id}', 1001, '2026-11-01', ${T(2026, 11, 2)})`), null, 'un ajout : 1 000 au plus');
  });

  test('défis : minuit, 23 h 59 compte pour le jour, 0 h 01 pour le lendemain (heure locale)', () => {
    const id = make();
    const late = run(`localISO(${T(2026, 11, 3, 23, 59)})`), early = run(`localISO(${T(2026, 11, 4, 0, 1)})`);
    assert.equal(late, '2026-11-03');
    assert.equal(early, '2026-11-04');
    run(`defiAdd(data, '${id}', 50, localISO(${T(2026, 11, 3, 23, 59)}), ${T(2026, 11, 3, 23, 59)})`);
    run(`defiAdd(data, '${id}', 20, localISO(${T(2026, 11, 4, 0, 1)}), ${T(2026, 11, 4, 0, 1)})`);
    assert.equal(run(`defiDayTotal(data.defis['${id}'], '2026-11-03')`), 50);
    assert.equal(run(`defiDayTotal(data.defis['${id}'], '2026-11-04')`), 20);
    // Changement d'heure (25 octobre 2026 en France) : l'addition de jours reste sur le calendrier
    assert.equal(run(`defiAddDays('2026-10-24', 1)`), '2026-10-25');
    assert.equal(run(`defiAddDays('2026-10-25', 1)`), '2026-10-26');
    assert.equal(run(`defiAddDays('2026-03-28', 2)`), '2026-03-30');
    assert.equal(run(`defiDaysBetween('2026-10-24', '2026-10-27')`), 3);
  });

  test('défis : série, aujourd\'hui pas encore fait ne la casse pas, un jour manqué si', () => {
    const id = make();
    for (const d of ['01', '02', '03', '04']) run(`defiAdd(data, '${id}', 100, '2026-11-${d}', ${T(2026, 11, 6)})`);
    const c = `data.defis['${id}']`;
    assert.equal(run(`defiStreak(${c}, '2026-11-05')`), 4, 'le 5 en cours : la série reste à 4');
    run(`defiAdd(data, '${id}', 100, '2026-11-05', ${T(2026, 11, 6)})`);
    assert.equal(run(`defiStreak(${c}, '2026-11-05')`), 5);
    assert.equal(run(`defiStreak(${c}, '2026-11-07')`), 0, 'le 6 manqué');
    const s = run(`defiStats(${c}, '2026-11-07')`);
    sameJSON({ held: s.held, missed: s.missed, total: s.total, best: s.best }, { held: 5, missed: 1, total: 500, best: 100 });
    assert.equal(run(`defiStreakText(12)`), '12 jours de suite');
    assert.equal(run(`defiStreakText(1)`), '1 jour de suite');
  });

  test('défis : pause, jours neutres, la série continue et la fin recule', () => {
    const id = make();
    const c = `data.defis['${id}']`;
    run(`defiAdd(data, '${id}', 100, '2026-11-01', ${T(2026, 11, 2)}); defiAdd(data, '${id}', 100, '2026-11-02', ${T(2026, 11, 2)})`);
    assert.equal(run(`defiPause(data, '${id}', true, ${T(2026, 11, 3, 8)})`), true);
    assert.equal(run(`defiPause(data, '${id}', false, ${T(2026, 11, 6, 8)})`), true);
    sameJSON(run(`${c}.pauses`), [{ from: '2026-11-03', to: '2026-11-05' }]);
    assert.equal(run(`defiDayState(${c}, '2026-11-04', '2026-11-06')`), 'paused');
    run(`defiAdd(data, '${id}', 100, '2026-11-06', ${T(2026, 11, 6, 9)})`);
    assert.equal(run(`defiStreak(${c}, '2026-11-06')`), 3, 'pause sautée');
    assert.equal(run(`defiLastDay(${c})`), '2026-12-03', '30 jours + 3 jours de pause');
    // Pause et reprise le même jour : rien ne reste
    const id2 = make();
    run(`defiPause(data, '${id2}', true, ${T(2026, 11, 3, 8)}); defiPause(data, '${id2}', false, ${T(2026, 11, 3, 9)})`);
    sameJSON(run(`data.defis['${id2}'].pauses`), []);
  });

  test('défis : changer l\'objectif ne réécrit pas les jours passés', () => {
    const id = make();
    const c = `data.defis['${id}']`;
    run(`defiAdd(data, '${id}', 100, '2026-11-01', ${T(2026, 11, 1, 20)})`);
    run(`defiEdit(data, '${id}', { goal: 150 }, ${T(2026, 11, 2, 8)})`);
    assert.equal(run(`defiGoalOn(${c}, '2026-11-01')`), 100);
    assert.equal(run(`defiGoalOn(${c}, '2026-11-02')`), 150);
    assert.equal(run(`defiDayState(${c}, '2026-11-01', '2026-11-03')`), 'done', 'le 1er reste tenu à 100');
  });

  test('défis : corriger un jour passé et Annuler la correction', () => {
    const id = make();
    const c = `data.defis['${id}']`;
    run(`defiAdd(data, '${id}', 40, '2026-11-01', ${T(2026, 11, 1, 20)}); defiAdd(data, '${id}', 20, '2026-11-01', ${T(2026, 11, 1, 21)})`);
    const r = run(`defiSetDay(data, '${id}', '2026-11-01', 100, ${T(2026, 11, 3)})`);
    assert.equal(run(`defiDayTotal(${c}, '2026-11-01')`), 100);
    assert.equal(run(`${c}.gone.length`), 2, 'anciens ajouts retirés pour de bon (synchro)');
    run(`defiRestoreDay(data, '${id}', '2026-11-01', ${j(r.before)}, ${T(2026, 11, 3)})`);
    assert.equal(run(`defiDayTotal(${c}, '2026-11-01')`), 60);
    run(`defiSetDay(data, '${id}', '2026-11-01', 0, ${T(2026, 11, 3)})`);
    assert.equal(run(`${c}.log['2026-11-01']`), undefined, '0 : jour vidé');
  });

  test('défis : fusion de la synchro, ajouts hors ligne des deux côtés gardés, annulés jamais ressuscités, commutative', () => {
    const id = make();
    run(`defiAdd(data, '${id}', 30, '2026-11-01', ${T(2026, 11, 1, 8)})`);
    const base = run(`JSON.parse(JSON.stringify(data.defis))`);
    // Appareil A : +40 ; appareil B : +30 puis annule le premier ajout commun
    const A = JSON.parse(j(base)), B = JSON.parse(j(base));
    A[id].log['2026-11-01'].push({ id: 'aaaa1', n: 40, at: T(2026, 11, 1, 12) });
    const first = B[id].log['2026-11-01'][0].id;
    B[id].log['2026-11-01'] = [{ id: 'bbbb1', n: 30, at: T(2026, 11, 1, 13) }];
    B[id].gone = [first];
    const m1 = run(`mergeDefis(${j(A)}, ${j(B)}, ${T(2026, 11, 2)})`), m2 = run(`mergeDefis(${j(B)}, ${j(A)}, ${T(2026, 11, 2)})`);
    sameJSON(m1, m2, 'commutative');
    sameJSON(m1[id].log['2026-11-01'].map(e => e.id), ['aaaa1', 'bbbb1'], 'les deux ajouts, sans celui annulé');
    // Réglages : le plus récent gagne
    A[id].goals = [{ from: '2026-11-01', n: 120 }]; A[id].at = T(2026, 11, 1, 14);
    B[id].remind = '07:30'; B[id].at = T(2026, 11, 1, 15);
    const m3 = run(`mergeDefis(${j(A)}, ${j(B)}, ${T(2026, 11, 2)})`);
    assert.equal(m3[id].remind, '07:30');
    assert.equal(m3[id].log['2026-11-01'].length, 2, 'ajouts réunis quel que soit le gagnant');
    // Suppression plus récente : le défi ne revient pas
    const D = { [id]: { id, deleted: true, at: T(2026, 11, 1, 16) } };
    const m4 = run(`mergeDefis(${j(A)}, ${j(D)}, ${T(2026, 11, 2)})`);
    assert.equal(m4[id].deleted, true);
  });

  test('défis : synchro du profil, partent avec le profil et sont fusionnés dans toutes les branches', () => {
    const id = make();
    run(`defiAdd(data, '${id}', 30, '2026-11-01', ${T(2026, 11, 1, 8)})`);
    assert.equal(run(`'defis' in profilePayload(data)`), true);
    assert.equal(run(`SYNC_PROFILE_KEYS.includes('defisRecapOff') && SYNC_ABSENT_IS_CHOICE.includes('defisRecapOff')`), true);
    const remote = run(`JSON.parse(JSON.stringify(data.defis))`);
    remote[id].log['2026-11-01'].push({ id: 'rrrr1', n: 50, at: T(2026, 11, 1, 10) });
    // Profil inchangé ici (empreinte connue) : le compte ne remplace pas, il fusionne (l'ajout local reste)
    run(`defiAdd(data, '${id}', 5, '2026-11-01', ${T(2026, 11, 1, 11)})`);
    const meta = run(`(() => { const m = emptySyncMeta('u'); m.profileHash = syncHash(profilePayload(data)); return m; })()`);
    run(`__meta = ${j(meta)}`);
    run(`applyRemoteProfile(data, { doc: { ...profilePayload(data), defis: ${j(remote)} }, updated_at: '2026-11-01T12:00:00Z' }, __meta)`);
    assert.equal(run(`defiDayTotal(data.defis['${id}'], '2026-11-01')`), 85, '30 + 50 du compte + 5 d\'ici');
    // Appareil vierge : rien de perdu non plus
    run(`data.history = []`);
    run(`applyRemoteProfile(data, { doc: { defis: ${j(remote)} }, updated_at: '2026-11-01T13:00:00Z' }, emptySyncMeta('u'))`);
    assert.equal(run(`defiDayTotal(data.defis['${id}'], '2026-11-01')`), 85);
  });

  test('défis : boutons de pas selon l\'objectif, textes, titre', () => {
    sameJSON(run('defiSteps(100)'), [5, 10, 20]);
    sameJSON(run('defiSteps(20)'), [1, 5]);
    sameJSON(run('defiSteps(120, "time")'), [15, 30, 60]);
    assert.equal(run('defiStepLabel(60, "time")'), '+1 min');
    assert.equal(run('defiAmount(90, "time")'), '1 min 30 s');
    assert.equal(run('defiAmountSpoken(90, "time")'), '1 minute 30 secondes');
    assert.equal(run('defiParseAmount("1:30", "time")'), 90);
    assert.equal(run('defiParseAmount("abc", "reps")'), null);
    const id = make();
    assert.equal(run(`defiTitle(data.defis['${id}'], 100)`), '100 pompes par jour');
  });

  test('défis : export CSV (une ligne par jour), JSON complet', () => {
    const id = make();
    run(`defiAdd(data, '${id}', 60, '2026-11-01', ${T(2026, 11, 1, 8)}); defiAdd(data, '${id}', 40, '2026-11-01', ${T(2026, 11, 1, 9)})`);
    const csv = run('historyCsv(data)');
    assert.match(csv, /2026-11-01;Défi;Pompes;;;100;;Objectif 100/);
    assert.equal(run(`JSON.parse(JSON.stringify(data)).defis['${id}'].log['2026-11-01'].length`), 2);
  });

  test('défis : récap de la période, seulement les défis avec un jour tenu, coupé par le réglage', () => {
    const id = make();
    for (const d of ['01', '02', '03']) run(`defiAdd(data, '${id}', 100, '2026-11-${d}', ${T(2026, 11, 4)})`);
    run(`defiAdd(data, '${id}', 50, '2026-11-04', ${T(2026, 11, 4)})`);
    const p = run(`recapPeriod('month', ${T(2026, 11, 15)}, ${T(2026, 12, 2)})`);
    const list = run(`recapDefis(${j(p)}, ${T(2026, 11, 5)})`);
    sameJSON(list.map(x => [x.name, x.total, x.held, x.days]), [['Pompes', 350, 3, 5]], '5 jours comptés au 5 novembre');
    assert.equal(run(`recapDefiHeld(${j(list[0])})`), '3 jours tenus sur 5');
    run('data.defisRecapOff = true');
    sameJSON(run(`recapDefis(${j(p)}, ${T(2026, 11, 5)})`), [], 'réglage coupé : rien');
    run('delete data.defisRecapOff');
    const empty = run(`recapPeriod('month', ${T(2026, 9, 15)}, ${T(2026, 12, 2)})`);
    sameJSON(run(`recapDefis(${j(empty)}, ${T(2026, 11, 5)})`), [], 'aucun défi sur la période : pas de bloc');
  });

  test('défis : rappels, pas aujourd\'hui si c\'est fait, rien en pause, 14 jours au plus', () => {
    const id = make({ remind: '18:00' });
    const now = T(2026, 11, 1, 9);
    let plan = run(`defiReminderPlan(data, ${now})`);
    assert.equal(plan.length, 14);
    assert.equal(plan[0].at, T(2026, 11, 1, 18));
    run(`defiAdd(data, '${id}', 100, '2026-11-01', ${now})`);
    plan = run(`defiReminderPlan(data, ${now})`);
    assert.equal(plan[0].at, T(2026, 11, 2, 18), 'fait aujourd\'hui : demain');
    run(`defiPause(data, '${id}', true, ${now})`);
    assert.equal(run(`defiReminderPlan(data, ${now}).length`), 0);
    assert.match(run(`defiReminderPlan(data, ${now}).map(x => x.body).join('')`), /^$/);
  });

  test('défis : arrêter, relancer, supprimer (trace pour la synchro), terminé après 30 jours', () => {
    const id = make();
    assert.equal(run(`defiStop(data, '${id}', ${T(2026, 11, 5)})`), true);
    assert.equal(run('defiList(data).length'), 0);
    assert.equal(run('defiList(data, { ended: true }).length'), 1);
    assert.equal(run(`defiResume(data, '${id}', ${T(2026, 11, 5)})`), true);
    run(`defiDelete(data, '${id}', ${T(2026, 11, 6)})`);
    sameJSON(run(`data.defis['${id}']`), { id, deleted: true, at: T(2026, 11, 6) });
    const id2 = make();
    assert.equal(run(`defiCloseFinished(data, ${T(2026, 12, 1, 8)})`), 1, 'le 1er décembre : 30 jours passés');
    assert.equal(run(`!!data.defis['${id2}'].endedAt`), true);
  });

  test('défis : textes sobres, sans emoji ni point d\'exclamation, ni flamme', () => {
    const src = run(`[defiStreakText(3), defiTitle({ name: 'Pompes', measure: 'reps', goals: [{ from: '2026-11-01', n: 100 }] }, 100)].join(' ')`);
    assert.doesNotMatch(src, /[!\u{1F300}-\u{1FAFF}]/u);
  });
}
