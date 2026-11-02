// ═══════════════════════════════════════════════════════════
//  Accueil et Mon profil : calculs purs
// ═══════════════════════════════════════════════════════════
//
// Régularité sur 12 semaines (regularity, js/data/accessors.js), « Membre depuis » (memberSince),
// records récents et gain (recentRecords, recordGainTxt, js/data/records.js), activité groupée
// (groupActivity, sessionDayTxt, reactionsGroupText, reactorsLine, js/data/social.js).

export default function ({ test, run, reset, assert, sameJSON }) {
  const at = (y, m, d, h = 18) => new Date(y, m, d, h).getTime();
  const NOW = at(2026, 10, 1, 10);   // dimanche 1er novembre 2026, 10 h
  const entry = (id, date, extra = {}) => ({ id, programme: 'ppl', category: 'push', date, exercises: [], ...extra });
  const setHistory = list => run(`data.history = ${JSON.stringify(list)}`);

  test('regularity : 12 semaines du lundi au lundi, moyenne au dixième, semaine en cours comprise', () => {
    reset();
    // Une séance par semaine depuis 20 semaines, deux cette semaine (lundi 26 octobre et ce dimanche)
    const list = Array.from({ length: 20 }, (_, i) => entry(`w${i}`, at(2026, 9, 21 - 7 * i)));
    list.push(entry('lun', at(2026, 9, 26)), entry('dim', at(2026, 10, 1, 8)));
    setHistory(list);
    const r = run(`regularity(12, ${NOW})`);
    assert.equal(r.weeks.length, 12);
    assert.equal(r.weeks[11].start, at(2026, 9, 26, 0), 'dernière barre : lundi 26 octobre 0 h');
    assert.equal(r.weeks[11].n, 2);
    assert.equal(r.weeks[0].n, 1);
    assert.equal(r.span, 12, 'historique plus ancien que la fenêtre : 12 semaines comptées');
    assert.equal(r.avg, 1.1, '13 séances / 12 semaines, au dixième');
  });

  test('regularity : un historique récent n\'est pas divisé par 12 ; vide : rien', () => {
    reset();
    setHistory([entry('a', at(2026, 9, 20)), entry('b', at(2026, 9, 22)), entry('c', at(2026, 9, 27)), entry('d', at(2026, 9, 29))]);
    const r = run(`regularity(12, ${NOW})`);
    assert.equal(r.span, 2, 'première séance la semaine dernière : 2 semaines comptées');
    assert.equal(r.avg, 2);
    assert.equal(r.weeks.reduce((a, w) => a + w.n, 0), 4);
    setHistory([]);
    sameJSON([run(`regularity(12, ${NOW}).avg`), run(`regularity(12, ${NOW}).span`)], [0, 0]);
    setHistory([entry('futur', at(2026, 11, 25))]);
    assert.equal(run(`regularity(12, ${NOW}).span`), 0, 'séance datée dans le futur seulement : pas de moyenne');
  });

  test('memberSince : la plus ancienne entre la première séance et la création du compte', () => {
    reset();
    setHistory([entry('a', at(2026, 7, 3)), entry('b', at(2026, 5, 14)), entry('c', at(2026, 9, 1))]);
    assert.equal(run('memberSince(null)'), at(2026, 5, 14), 'sans compte : la première séance');
    assert.equal(run(`memberSince('2026-03-02T10:00:00Z')`), Date.parse('2026-03-02T10:00:00Z'), 'compte plus ancien que l\'historique');
    assert.equal(run(`memberSince('2026-10-30T10:00:00Z')`), at(2026, 5, 14), 'séances importées d\'avant le compte');
    assert.equal(run(`memberSince('pas une date')`), at(2026, 5, 14));
    setHistory([]);
    assert.equal(run('memberSince(undefined)'), null, 'ni séance ni compte');
    assert.equal(run(`memberSince('2026-03-02T10:00:00Z')`), Date.parse('2026-03-02T10:00:00Z'));
  });

  test('recentRecords : les plus récents, un par exercice, le plus marquant d\'abord dans une séance', () => {
    reset();
    const rec = (ex, kind, before, after, extra = {}) => ({ ex, kind, before, after, ...extra });
    setHistory([
      entry('h4', at(2026, 9, 30), { records: [rec('Squat', 'reps', 8, 9, { w: 100 }), rec('Développé couché', 'charge', 80, 82.5)] }),
      entry('h3', at(2026, 9, 27), { records: [] }),
      entry('h2', at(2026, 9, 26), { records: [rec('Squat', 'charge', 95, 100)] }),   // plus ancien que celui du 30 : ignoré
      entry('h1', at(2026, 9, 20), { records: [rec('Rowing', 'charge', 60, 62.5)] }),
      entry('h0', at(2026, 9, 10), { records: [rec('Tractions', 'lest', 5, 10)] }),
    ]);
    const got = run('recentRecords(data.history, 3)').map(x => `${x.ex}/${x.r.kind}/${new Date(x.date).getDate()}`);
    sameJSON(got, ['Développé couché/charge/30', 'Squat/reps/30', 'Rowing/charge/20']);
    assert.equal(run('recentRecords(data.history, 10).length'), 4, 'un seul record par exercice');
    assert.equal(run('recentRecords([], 3).length'), 0);
    assert.equal(run('recentRecords(data.history, 3, 2).length'), 2, 'seules les dernières séances sont lues');
  });

  test('recentRecords : séance d\'avant les records notés recalculée, comme le bilan', () => {
    reset();
    const ex = (w, r) => [{ exId: 'sq', name: 'Squat', sets: [{ weight: String(w), reps: String(r) }] }];
    setHistory([entry('b', at(2026, 9, 28), { exercises: ex(102.5, 5) }), entry('a', at(2026, 9, 21), { exercises: ex(100, 5) })]);
    const got = run('recentRecords(data.history, 3)');
    assert.equal(got.length, 1);
    assert.equal(got[0].r.kind, 'charge');
    assert.equal(got[0].r.after, 102.5);
    assert.equal(run('recordGainTxt(recentRecords(data.history, 3)[0].r)'), '2,5 kg');
  });

  test('recentRecords : séances notées lues telles quelles, anciennes recalculées une fois par historique', () => {
    reset();
    const ex = (w, r) => [{ exId: 'sq', name: 'Squat', sets: [{ weight: String(w), reps: String(r) }] }];
    setHistory([
      entry('n', at(2026, 9, 30), { exercises: ex(105, 5), records: [{ ex: 'Squat', kind: 'charge', before: 102.5, after: 105 }] }),
      entry('b', at(2026, 9, 28), { exercises: ex(102.5, 5) }),
      entry('a', at(2026, 9, 21), { exercises: ex(100, 5) }),
    ]);
    const calls = run(`(() => {
      const orig = sessionRecords, seen = [];
      sessionRecords = (h, hist) => { seen.push(h.id); return orig(h, hist); };
      try { recentRecords(data.history, 3); recentRecords(data.history, 3); } finally { sessionRecords = orig; }
      return seen;
    })()`);
    sameJSON(calls, ['b', 'a'], 'séance notée jamais recalculée ; anciennes une seule fois pour deux affichages');
    const again = run(`(() => {
      const orig = sessionRecords, seen = [];
      sessionRecords = (h, hist) => { seen.push(h.id); return orig(h, hist); };
      try { data.history.unshift({ id: 'z', programme: 'ppl', category: 'push', date: ${at(2026, 9, 31)}, exercises: [], records: [] });
        recentRecords(data.history, 3); } finally { sessionRecords = orig; }
      return seen;
    })()`);
    sameJSON(again, ['b', 'a'], 'historique changé : recalculées à nouveau');
  });

  test('recentRecords : séance passée modifiée ou exercice renommé puis save() : cache invalidé', () => {
    reset();
    const ex = (name, w) => [{ name, sets: [{ weight: String(w), reps: '5' }] }];
    setHistory([
      entry('b', at(2026, 9, 28), { exercises: ex('Squat', 105) }),
      entry('a', at(2026, 9, 21), { exercises: ex('Squat', 100) }),
    ]);
    const top = () => run('(() => { const r = recentRecords(data.history, 3)[0]; return r ? `${r.ex}/${r.r.after}` : null; })()');
    assert.equal(top(), 'Squat/105');
    // Séance passée modifiée : même nombre de séances, même plus récente ; seule la version des données change
    run(`data.history[1].exercises[0].sets[0].weight = '110'; save(true)`);
    assert.equal(top(), null, 'séance d\'avant plus lourde : plus de record');
    run(`data.history[1].exercises[0].sets[0].weight = '100'; save(true)`);
    assert.equal(top(), 'Squat/105');
    run(`data.history.forEach(h => { h.exercises[0].name = 'Squat barre'; }); save(true)`);
    assert.equal(top(), 'Squat barre/105', 'exercice renommé dans l\'historique');
    // Sans save(), la même empreinte : le cache sert (rien n'est recalculé)
    const calls = run(`(() => {
      const orig = sessionRecords; let n = 0;
      sessionRecords = (h, hist) => { n++; return orig(h, hist); };
      try { recentRecords(data.history, 3); entryRecords(data.history[0]); } finally { sessionRecords = orig; }
      return n;
    })()`);
    assert.equal(calls, 0, 'entryRecords et recentRecords partagent le cache');
  });

  test('recordGainTxt : sans signe, flèche dessinée à côté ; rien quand mieux veut dire moins', () => {
    reset();
    const g = r => run(`recordGainTxt(${JSON.stringify(r)})`);
    assert.equal(g({ ex: 'Squat', kind: 'charge', before: 100, after: 102.5 }), '2,5 kg');
    assert.equal(g({ ex: 'Tractions', kind: 'lest', before: 5, after: 10 }), '5 kg');
    assert.equal(g({ ex: 'Squat', kind: 'reps', before: 8, after: 9, w: 100 }), '1 rep');
    assert.equal(g({ ex: 'Squat', kind: 'reps', before: 8, after: 11, w: 100 }), '3 reps');
    assert.equal(g({ ex: 'Course', kind: 'distance', before: 5, after: 6.2 }), '1,2 km');
    assert.equal(g({ ex: 'Course', kind: 'duree', before: 30, after: 45 }), '15 min');
    assert.equal(g({ ex: 'Tractions assistées', kind: 'aide', before: 20, after: 15 }), '', 'aide : moins, pas de ↑');
    assert.equal(g({ ex: 'Course', kind: 'allure', before: 300, after: 290, d: 5 }), '', 'allure : moins, pas de ↑');
    assert.equal(g({ ex: 'Squat', kind: 'charge', after: 100 }), '', 'séance d\'un ami : pas de valeur d\'avant');
    assert.equal(g(null), '');
    reset({ unit: 'lbs' });
    assert.equal(g({ ex: 'Squat', kind: 'charge', before: 100, after: 102.5 }), '5,5 lbs', 'unité affichée');
  });

  test('groupActivity : réactions d\'une même séance groupées dès deux, le reste à part, ordre gardé', () => {
    const rows = [
      { kind: 'comment', user_id: 'lea', sessionId: 's1', text: 'Bravo' },
      { kind: 'reaction', user_id: 'lea', sessionId: 's1' },
      { kind: 'follower', user_id: 'ines' },
      { kind: 'reaction', user_id: 'paul', sessionId: 's1' },
      { kind: 'reaction', user_id: 'zoe', sessionId: 's2' },
      { kind: 'reaction', user_id: 'tom', sessionId: 's1' },
      { kind: 'request', user_id: 'ugo' },
    ];
    const g = run(`groupActivity(${JSON.stringify(rows)})`);
    sameJSON(g.map(x => (x.kind === 'single' ? `${x.row.kind}:${x.row.user_id}` : `${x.sessionId}×${x.rows.length}`)),
      ['comment:lea', 's1×3', 'follower:ines', 'reaction:zoe', 'request:ugo']);
    sameJSON(g[1].rows.map(r => r.user_id), ['lea', 'paul', 'tom'], 'du plus récent au plus ancien dans le groupe');
    sameJSON(run('groupActivity([])'), []);
    sameJSON(run('groupActivity(null)'), []);
  });

  test('sessionDayTxt, reactionsGroupText, reactorsLine : « 3 réactions sur Push de vendredi »', () => {
    reset();
    assert.equal(run(`sessionDayTxt(${at(2026, 10, 1, 8)}, ${NOW})`), 'd\'aujourd\'hui');
    assert.equal(run(`sessionDayTxt(${at(2026, 9, 31, 23)}, ${NOW})`), 'd\'hier');
    assert.equal(run(`sessionDayTxt(${at(2026, 9, 30)}, ${NOW})`), 'de vendredi');
    assert.equal(run(`sessionDayTxt(${at(2026, 9, 26)}, ${NOW})`), 'de lundi');
    assert.equal(run(`sessionDayTxt(${at(2026, 9, 20)}, ${NOW})`), 'du 20 oct.');
    assert.equal(run(`sessionDayTxt(null, ${NOW})`), '');
    assert.equal(run(`reactionsGroupText(3, 'Push', ${at(2026, 9, 30)}, ${NOW})`), '3 réactions sur Push de vendredi');
    assert.equal(run(`reactionsGroupText(2, '', null, ${NOW})`), '2 réactions sur ta séance', 'séance inconnue de cet appareil, sans date');
    assert.equal(run(`reactorsLine(['lea', 'paul'])`), 'lea, paul');
    assert.equal(run(`reactorsLine(['lea', 'paul', 'tom', 'lea'])`), 'lea, paul +1', 'sans doublon');
  });
}
