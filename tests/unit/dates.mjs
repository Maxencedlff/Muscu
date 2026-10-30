// ═══════════════════════════════════════════════════════════
//  Dates du calendrier : jours de la semaine, semaines, « il y a N jours »
// ═══════════════════════════════════════════════════════════
//
// Les cas pièges sont les changements d'heure : la semaine du 19 au 25 octobre 2026 dure 169 h
// (heure d'hiver le dimanche 25 à 3 h), un jour n'y fait pas toujours 24 h. Les tests se placent
// à l'heure de Paris (process.env.TZ) et figent « maintenant » dans le contexte de l'app.

export default function ({ test, run, reset, assert, app }) {
  // Heure de Paris le temps du test, puis le fuseau d'avant
  function inParis(fn) {
    const before = process.env.TZ;
    process.env.TZ = 'Europe/Paris';
    try { return fn(); }
    finally { if (before === undefined) delete process.env.TZ; else process.env.TZ = before; }
  }
  // « Maintenant » figé dans l'app : Date.now() et new Date() sans argument
  function atNow(ts, fn) {
    run(`globalThis.__RealDate ||= Date;
      globalThis.Date = class extends __RealDate {
        constructor(...a) { if (a.length) super(...a); else super(${ts}); }
        static now() { return ${ts}; }
      };`);
    try { return fn(); }
    finally { run('globalThis.Date = __RealDate;'); }
  }
  const at = (...a) => new Date(...a).getTime();   // heure locale (Paris pendant les tests)
  const entry = (id, date, extra = {}) => ({ id, programme: 'ppl', category: 'push', date, exercises: [], ...extra });

  test('weekStats : séance du dimanche à 23 h 30, semaine du passage à l\'heure d\'hiver', () => inParis(() => {
    reset();
    const sunday = at(2026, 9, 25, 23, 30);
    run(`data.history = ${JSON.stringify([
      entry('dim', sunday),
      entry('lun', at(2026, 9, 19, 0, 30)),
      entry('avant', at(2026, 9, 18, 23, 30)),
    ])}`);
    const ws = atNow(at(2026, 9, 25, 23, 45), () => app.weekStats());
    assert.equal(ws.today, 6, 'aujourd\'hui : dimanche');
    assert.equal(ws.days[6].length, 1, 'séance du dimanche 23 h 30 comptée dimanche');
    assert.equal(ws.days[0].length, 1, 'séance du lundi 0 h 30 comptée lundi');
    assert.equal(ws.count, 2, 'dimanche d\'avant hors de la semaine');
  }));

  test('dayIndexInWeek, addDays : lundi 0 … dimanche 6, jours du calendrier', () => inParis(() => {
    assert.equal(app.dayIndexInWeek(at(2026, 9, 19, 0, 0)), 0);
    assert.equal(app.dayIndexInWeek(at(2026, 9, 25, 23, 59)), 6);
    assert.equal(app.addDays(at(2026, 9, 19), 7), at(2026, 9, 26), 'lundi + 7 jours : lundi 0 h, pas dimanche 23 h');
    assert.equal(app.addDays(at(2026, 9, 26), -7), at(2026, 9, 19), 'recul d\'une semaine : lundi 0 h, pas 1 h');
    assert.equal(app.addDays(at(2026, 2, 29, 12), 1), at(2026, 2, 30, 12), 'passage à l\'heure d\'été : même heure');
  }));

  test('weeklySessionCounts : limites des semaines au lundi 0 h, même après un changement d\'heure', () => inParis(() => {
    reset();
    run(`data.history = ${JSON.stringify([
      entry('lun', at(2026, 9, 19, 0, 30)),   // lundi 0 h 30, avant le changement d'heure
      entry('dim', at(2026, 9, 25, 23, 30)),
      entry('cette', at(2026, 9, 27, 18)),
    ])}`);
    const weeks = app.weeklySessionCounts(12, at(2026, 9, 28, 12));
    assert.equal(weeks.length, 12);
    assert.equal(weeks[11].start, at(2026, 9, 26), 'semaine en cours : lundi 26 à 0 h');
    assert.equal(weeks[10].start, at(2026, 9, 19), 'semaine d\'avant : lundi 19 à 0 h (heure d\'été)');
    assert.equal(weeks[0].start, at(2026, 7, 10), 'onze semaines plus tôt : lundi 10 août à 0 h');
    assert.equal(weeks[10].n, 2, 'lundi 0 h 30 et dimanche 23 h 30 dans la semaine du 19');
    assert.equal(weeks[11].n, 1);
    assert.equal(weeks[9].n, 0, 'rien n\'a glissé dans la semaine d\'avant');
  }));

  test('daysAgo : jours du calendrier, pas des tranches de 24 h', () => inParis(() => {
    const now = at(2026, 9, 26, 8);
    assert.equal(app.daysAgo(at(2026, 9, 26, 0, 5), now), 0);
    assert.equal(app.daysAgo(at(2026, 9, 25, 22), now), 1, 'hier 22 h, aujourd\'hui 8 h : hier');
    assert.equal(app.daysAgo(at(2026, 9, 25, 0, 30), at(2026, 9, 26, 23, 59)), 1, 'jour de 25 h');
    assert.equal(app.daysAgo(at(2026, 9, 23, 12), now), 3);
    assert.equal(app.daysAgo(at(2026, 2, 28, 23), at(2026, 2, 29, 23, 30)), 1, 'jour de 23 h');
    assert.equal(app.daysAgo(at(2026, 9, 27, 9), now), -1, 'demain : négatif');
    assert.equal(app.daysAgo(at(2025, 11, 31, 23), at(2026, 0, 1, 1)), 1, 'changement d\'année');
  }));

  test('exportStale (Sauvegarde) : orange sans compte si jamais exporté ou plus de 14 jours ; jamais avec un compte', () => {
    const day = 86400000, now = 20 * day;
    assert.equal(app.exportStale({}, false, now), true, 'jamais exporté');
    assert.equal(app.exportStale({ lastExport: now - 15 * day }, false, now), true, '15 jours');
    assert.equal(app.exportStale({ lastExport: now - 13 * day }, false, now), false, '13 jours');
    assert.equal(app.exportStale({}, true, now), false, 'compte : les séances sont déjà dessus');
    assert.equal(app.exportStale({ lastExport: now - 40 * day }, true, now), false);
  });

  test('agoText (export, supprimés) : un export d\'hier 22 h s\'affiche « hier »', () => inParis(() => {
    const now = at(2026, 9, 26, 10);
    atNow(now, () => {
      assert.equal(app.agoText(at(2026, 9, 25, 22)), 'hier');
      assert.equal(app.agoText(at(2026, 9, 26, 0, 1)), 'aujourd\'hui');
      assert.equal(app.agoText(at(2026, 9, 24, 23)), 'il y a 2 jours');
    });
  }));

  test('Supprimés récemment : « supprimée hier » et les jours restants s\'additionnent à 30', () => inParis(() => {
    const now = at(2026, 9, 26, 8);
    const hier = { deletedAt: at(2026, 9, 25, 23) };                  // la veille à 23 h, 9 h plus tôt
    assert.equal(app.daysAgo(hier.deletedAt, now) + app.trashDaysLeft(hier, now), 30);
    assert.equal(app.trashDaysLeft(hier, now), 29);
    const vieille = { deletedAt: at(2026, 8, 27, 23) };               // 29 jours du calendrier plus tôt
    assert.equal(app.trashDaysLeft(vieille, now), 1);
  }));

  test('fmtDate, recoveryReason : mêmes jours du calendrier', () => inParis(() => {
    reset();
    atNow(at(2026, 9, 26, 0, 30), () => {
      assert.equal(app.fmtDate(at(2026, 9, 26, 0, 10)), 'Aujourd\'hui');
      assert.equal(app.fmtDate(at(2026, 9, 25, 0, 30)), 'Hier', 'dimanche de 25 h');
      assert.match(app.recoveryReason({ muscle: 'biceps', entry: { programme: 'free', category: 'free', date: at(2026, 9, 25, 23) } }), / : hier, séance libre$/);
      assert.match(app.recoveryReason({ muscle: 'biceps', entry: { programme: 'free', category: 'free', date: at(2026, 9, 23, 23) } }), / : il y a 3 jours, /);
    });
  }));
}
