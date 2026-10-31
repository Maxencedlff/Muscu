// ═══════════════════════════════════════════════════════════
//  Apple Watch, widget et Siri : ce que l'app envoie et ce qu'elle accepte
// ═══════════════════════════════════════════════════════════
//
// Le code natif (ios/App/AppExtras, ios/App/Watch, ios/App/Widgets) n'est pas compilé ici : ces tests
// couvrent la logique JS (état de la montre, gestes acceptés, instantané du widget, demande de Siri)
// et vérifient que les noms partagés avec le Swift (modules, évènements, clés) sont les mêmes des deux côtés.

import fs from 'node:fs';
import path from 'node:path';

export default function ({ test, run, reset, assert, app, sameJSON, ctx, nativeContext, ROOT }) {
  const H = 3_600_000, D = 24 * H;
  const json = v => JSON.stringify(v);
  const swift = f => fs.readFileSync(path.join(ROOT, 'ios/App', f), 'utf8');

  const session = (sets = [{ weight: '80', reps: '8' }, { weight: '80', reps: '8' }], extra = {}) => ({
    category: 'push', programme: 'ppl', startedAt: 1_700_000_000_000,
    exercises: [{ name: 'Développé couché haltères', measure: 'reps', sets }], ...extra,
  });

  // ── Montre : état envoyé ───────────────────────────────────

  test('montre : sans séance, la prochaine séance seulement', () => {
    reset();
    sameJSON(run('watchState(null, null, { next: { title: "Push", tint: "orange" } })'),
      { v: 1, active: false, next: { title: 'Push', tint: 'orange' } });
    sameJSON(run('watchState(null, null)'), { v: 1, active: false, next: null });
  });

  test('montre : série en cours, compteurs, couleur, repos arrondi', () => {
    reset();
    const s = session([{ weight: '80', reps: '8', done: true }, { weight: '82.5', reps: '6' }]);
    const st = run(`watchState(${json(s)}, { ei: 0, si: 1 }, { rest: { endTime: 1700000090000.4, total: 89.6 } })`);
    assert.equal(st.active, true);
    assert.equal(st.title, 'Push');
    assert.equal(st.tint, 'orange');
    assert.equal(st.exercise, 'Développé couché haltères');
    assert.equal(st.setNo, 2);
    assert.equal(st.setCount, 2);
    assert.equal(st.load, '82,5 kg × 6');
    assert.equal(st.done, 1);
    assert.equal(st.total, 2);
    sameJSON(st.cur, { ei: 0, si: 1 });
    sameJSON(st.rest, { endTime: 1700000090000, total: 90 });
    assert.equal(st.canValidate, true);
    assert.equal(st.blocked, '');
    reset({ unit: 'lbs' });
    assert.equal(run(`watchState(${json(s)}, { ei: 0, si: 1 })`).load, '181,9 lbs × 6', 'unité de l\'utilisateur');
  });

  test('montre : toutes les séries faites, rien à valider ; textes bornés', () => {
    reset();
    const done = run(`watchState(${json(session([{ weight: '80', reps: '8', done: true }]))}, null)`);
    assert.equal(done.cur, null);
    assert.equal(done.canValidate, false);
    assert.equal(done.exercise, '');
    const long = session([{ weight: '20', reps: '10' }]);
    long.exercises[0].name = 'X'.repeat(300);
    const st = run(`watchState(${json(long)}, { ei: 0, si: 0 })`);
    assert.equal(st.exercise.length, 60);
    assert.ok(json(st).length < 1024, 'état léger (WatchConnectivity, contexte remplacé à chaque envoi)');
  });

  test('montre : blocages (chrono, durée, correction, valeur inhabituelle) montrés, pas validables', () => {
    reset();
    const s = session();
    assert.equal(run(`watchBlockReason(${json(s)}, { ei: 0, si: 0 })`), '');
    assert.equal(run(`watchBlockReason(${json({ ...s, effort: { ei: 0, si: 0 } })}, { ei: 0, si: 0 })`), 'effort');
    const timed = session([{ weight: '', reps: '30' }]);
    timed.exercises[0].measure = 'time';
    assert.equal(run(`watchBlockReason(${json(timed)}, { ei: 0, si: 0 })`), 'measure');
    assert.equal(run(`watchBlockReason(${json(s)}, { ei: 0, si: 0 }, { editing: true })`), 'editing');
    assert.equal(run(`watchBlockReason(${json(s)}, { ei: 0, si: 0 }, { odd: true })`), 'odd');
    assert.equal(run(`watchBlockReason(${json(s)}, null)`), 'none');
    const st = run(`watchState(${json(s)}, { ei: 0, si: 0 }, { block: 'odd' })`);
    assert.equal(st.canValidate, false);
    assert.equal(st.blocked, 'À confirmer sur l\'iPhone');
  });

  // ── Montre : gestes acceptés ───────────────────────────────

  test('montre : valider seulement la série en cours, et si elle est validable', () => {
    reset();
    const st = run(`watchState(${json(session())}, { ei: 0, si: 0 })`);
    sameJSON(app.watchActionFor({ type: 'validate', ei: 0, si: 0 }, st), { type: 'validate', ei: 0, si: 0 });
    assert.equal(app.watchActionFor({ type: 'validate', ei: 0, si: 1 }, st), null, 'geste périmé (série déjà passée)');
    assert.equal(app.watchActionFor({ type: 'validate', ei: '0', si: '0' }, st), null, 'types stricts');
    const blocked = run(`watchState(${json(session())}, { ei: 0, si: 0 }, { block: 'effort' })`);
    assert.equal(app.watchActionFor({ type: 'validate', ei: 0, si: 0 }, blocked), null);
    assert.equal(app.watchActionFor({ type: 'validate', ei: 0, si: 0 }, run('watchState(null, null)')), null, 'pas de séance');
  });

  test('montre : repos passé ou ±15 s seulement pendant un repos, rien d\'autre', () => {
    reset();
    const resting = run(`watchState(${json(session())}, { ei: 0, si: 0 }, { rest: { endTime: Date.now() + 60000, total: 90 } })`);
    const idle    = run(`watchState(${json(session())}, { ei: 0, si: 0 })`);
    sameJSON(app.watchActionFor({ type: 'skipRest' }, resting), { type: 'skipRest' });
    assert.equal(app.watchActionFor({ type: 'skipRest' }, idle), null);
    sameJSON(app.watchActionFor({ type: 'restAdjust', d: -15 }, resting), { type: 'restAdjust', d: -15 });
    sameJSON(app.watchActionFor({ type: 'restAdjust', d: 15 }, resting), { type: 'restAdjust', d: 15 });
    assert.equal(app.watchActionFor({ type: 'restAdjust', d: 600 }, resting), null, 'pas de saut arbitraire');
    assert.equal(app.watchActionFor({ type: 'restAdjust', d: 15 }, idle), null);
    assert.equal(app.watchActionFor({ type: 'finishSession' }, resting), null, 'geste inconnu');
    assert.equal(app.watchActionFor(null, resting), null);
    assert.equal(app.watchActionFor('validate', resting), null);
  });

  // ── Widget ─────────────────────────────────────────────────

  test('widget : semaine (couleur par jour), objectif, prochaine séance prête, fin de semaine', () => {
    reset();
    ctx.activeSession = null;
    const now = new Date();
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7)).getTime();
    const ts = monday + Math.floor((Date.now() - monday) / 2);   // dans la semaine, déjà passée
    run(`data.history = [{ id: 'a', programme: 'ppl', category: 'push', date: ${ts}, exercises: [] }]; data.weeklyGoal = 4;`);
    const snap = app.widgetSnapshot();
    assert.equal(snap.v, 1);
    assert.equal(snap.week.count, 1);
    assert.equal(snap.week.goal, 4);
    assert.equal(snap.week.days.length, 7);
    assert.equal(snap.week.days.filter(Boolean).length, 1);
    assert.equal(snap.week.days.find(Boolean), 'orange');
    assert.equal(snap.week.start, monday);
    assert.ok(snap.week.end > monday + 6 * D && snap.week.end <= monday + 7 * D + H, 'lundi suivant (changement d\'heure compris)');
    assert.equal(snap.next.title, run('rawLabel(nextSessionCat(sessionKeys()))'));
    assert.ok(snap.next.exercises > 0);
    assert.equal(snap.active, null);
    assert.ok(json(snap).length < 2048);
  });

  test('widget : séance pas encore prête (heure de reprise) et séance en cours', () => {
    reset();
    run(`data.history = []; for (const k of sessionKeys()) prog().timers[k] = Date.now() - 3600000;`);
    ctx.activeSession = session();
    try {
      const snap = app.widgetSnapshot();
      assert.ok(snap.next.readyAt > Date.now(), 'muscles encore en récupération : heure où la séance sera prête');
      sameJSON(snap.active, { title: 'Push', tint: 'orange', startedAt: 1_700_000_000_000 });
    } finally { ctx.activeSession = null; }
  });

  // ── Siri ───────────────────────────────────────────────────

  test('siri : démarrer la prochaine séance, reprendre celle en cours, sinon rien', () => {
    const now = 1_700_000_000_000, req = { action: 'startSession', at: now - 5000 };
    assert.equal(app.siriDecision(req, { now, next: 'push' }), 'start');
    assert.equal(app.siriDecision(req, { now, next: 'push', active: true }), 'resume');
    assert.equal(app.siriDecision(req, { now, next: 'push', busy: true }), null, 'Bienvenue, questions ou dialogue ouverts');
    assert.equal(app.siriDecision(req, { now, next: null }), null, 'aucune séance au programme');
    assert.equal(app.siriDecision({ action: 'startSession', at: now - 61_000 }, { now, next: 'push' }), null, 'demande trop ancienne');
    assert.equal(app.siriDecision({ action: 'startSession', at: now + 3_600_000 }, { now, next: 'push' }), null, 'heure dans le futur');
    assert.equal(app.siriDecision({ action: 'startSession' }, { now, next: 'push' }), null, 'sans heure');
    assert.equal(app.siriDecision({ action: 'deleteAll', at: now }, { now, next: 'push' }), null);
    assert.equal(app.siriDecision(null, { now, next: 'push' }), null);
  });

  // ── Pont natif ─────────────────────────────────────────────

  test('native : montre, widget et Siri muets dans le navigateur et dans une coquille sans les modules', async () => {
    for (const n of [nativeContext({ native: false }), nativeContext({ localData: '{}' })]) {
      assert.equal(n.Native.watch.available, false);
      n.Native.watch.send('{}');
      n.Native.watch.onAction(() => {});
      n.Native.widget.setSnapshot('{}');
      n.Native.shortcuts.onRequest(() => {});
      assert.equal(await n.Native.shortcuts.takeRequest(), null);
      assert.equal(n.calls.filter(c => /^Mdlf(Watch|Widget|Shortcuts)$/.test(c[0])).length, 0, 'aucun appel');
    }
  });

  test('native : modules présents → état et instantané relayés, demande de Siri nettoyée', async () => {
    const sent = [], listeners = {};
    const n = nativeContext({
      localData: '{}', available: ['MdlfWatch', 'MdlfWidget', 'MdlfShortcuts'],
      plugins: {
        MdlfWatch: {
          send: async o => { sent.push(['watch', o]); },
          addListener: (ev, fn) => { listeners[ev] = fn; return Promise.resolve({ remove() {} }); },
        },
        MdlfWidget: { setSnapshot: async o => { sent.push(['widget', o]); } },
        MdlfShortcuts: {
          takeRequest: async () => ({ action: 'startSession', at: '1700000000000', extra: 'x' }),
          addListener: () => Promise.resolve({ remove() {} }),
        },
      },
    });
    n.Native.watch.send('{"v":1}');
    n.Native.widget.setSnapshot('{"v":1}');
    sameJSON(sent, [['watch', { state: '{"v":1}' }], ['widget', { snapshot: '{"v":1}' }]]);
    const got = [];
    n.Native.watch.onAction(a => got.push(a));
    listeners.action({ type: 'skipRest' });
    sameJSON(got, [{ type: 'skipRest' }]);
    n.Native.watch.onAction(() => { throw new Error('boum'); });
    listeners.action({ type: 'skipRest' });   // une erreur de l'app ne remonte pas au pont
    sameJSON(await n.Native.shortcuts.takeRequest(), { action: 'startSession', at: 1700000000000 });
  });

  // ── Noms partagés avec le Swift (non compilé ici) ───────────

  test('natif : modules, évènements et clés identiques côté JS et côté Swift', () => {
    assert.match(swift('AppExtras/WatchPlugin.swift'), /jsName = "MdlfWatch"/);
    assert.match(swift('AppExtras/WatchPlugin.swift'), /notifyListeners\("action"/);
    assert.match(swift('AppExtras/WatchPlugin.swift'), /notifyListeners\("request"/);
    assert.match(swift('AppExtras/WidgetPlugin.swift'), /jsName = "MdlfWidget"/);
    assert.match(swift('AppExtras/ShortcutsPlugin.swift'), /jsName = "MdlfShortcuts"/);
    assert.match(swift('AppExtras/ShortcutsPlugin.swift'), /notifyListeners\("request"/);
    assert.match(swift('AppExtras/StartSessionIntent.swift'), /"startSession"/);
    const shared = swift('Shared/CompanionShared.swift');
    assert.match(shared, /appGroup = "group\.com\.mdlf\.training"/);
    // Gestes de la montre : ceux que watchActionFor accepte, rien d'autre
    for (const type of ['validate', 'skipRest', 'restAdjust']) assert.match(shared, new RegExp(`case ${type}\\b`));
    // Version de l'état et de l'instantané : la même des deux côtés
    assert.match(shared, new RegExp(`watchStateVersion = ${run('WATCH_VERSION')}\\b`));
    assert.match(shared, new RegExp(`widgetSnapshotVersion = ${run('WIDGET_VERSION')}\\b`));
    // Pas encore dans le projet Xcode : la build actuelle ne change pas (docs/WATCH_WIDGETS.md)
    assert.doesNotMatch(swift('App.xcodeproj/project.pbxproj'), /WatchPlugin\.swift|NextSessionWidget\.swift/);
  });
}
