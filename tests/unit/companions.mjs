// ═══════════════════════════════════════════════════════════
//  Apple Watch, widget et Siri : ce que l'app envoie et ce qu'elle accepte
// ═══════════════════════════════════════════════════════════
//
// Le code natif (ios/App/AppExtras, ios/App/Watch, ios/App/Widgets) n'est pas compilé ici : ces tests
// couvrent la logique JS (état de la montre, gestes acceptés, instantané du widget, demande de Siri)
// et vérifient que les noms partagés avec le Swift (modules, évènements, clés) sont les mêmes des deux côtés.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runtimeVersion } from '../../scripts/runtime-version.mjs';

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

  const NOW = 1_700_000_100_000, AT = NOW - 2000;   // geste fait il y a 2 s
  const act = (msg, st, now = NOW) => app.watchActionFor({ at: AT, ...msg }, st, now);

  test('montre : valider seulement la série en cours, et si elle est validable', () => {
    reset();
    const st = run(`watchState(${json(session())}, { ei: 0, si: 0 })`);
    sameJSON(act({ type: 'validate', ei: 0, si: 0 }, st), { type: 'validate', ei: 0, si: 0 });
    assert.equal(act({ type: 'validate', ei: 0, si: 1 }, st), null, 'geste périmé (série déjà passée)');
    assert.equal(act({ type: 'validate', ei: '0', si: '0' }, st), null, 'types stricts');
    const blocked = run(`watchState(${json(session())}, { ei: 0, si: 0 }, { block: 'effort' })`);
    assert.equal(act({ type: 'validate', ei: 0, si: 0 }, blocked), null);
    assert.equal(act({ type: 'validate', ei: 0, si: 0 }, run('watchState(null, null)')), null, 'pas de séance');
  });

  test('montre : geste valide mais trop ancien, dans le futur ou sans heure → ignoré', () => {
    reset();
    const st = run(`watchState(${json(session())}, { ei: 0, si: 0 }, { rest: { endTime: Date.now() + 60000, total: 90 } })`);
    const v = { type: 'validate', ei: 0, si: 0 };
    sameJSON(app.watchActionFor({ ...v, at: NOW - 30_000 }, st, NOW), v, '30 s pile : encore accepté (comme le natif)');
    assert.equal(app.watchActionFor({ ...v, at: NOW - 30_001 }, st, NOW), null, 'iPhone verrouillé : appliqué au déverrouillage, trop tard');
    assert.equal(app.watchActionFor({ ...v, at: NOW - 10 * 60_000 }, st, NOW), null);
    assert.equal(app.watchActionFor({ type: 'skipRest', at: NOW - 60_000 }, st, NOW), null, 'repos : même règle');
    assert.equal(app.watchActionFor({ type: 'restAdjust', d: 15, at: NOW - 60_000 }, st, NOW), null);
    sameJSON(app.watchActionFor({ ...v, at: NOW + 4000 }, st, NOW), v, 'horloge de la montre un peu en avance');
    assert.equal(app.watchActionFor({ ...v, at: NOW + 60_000 }, st, NOW), null, 'heure dans le futur');
    assert.equal(app.watchActionFor(v, st, NOW), null, 'sans heure');
    assert.equal(app.watchActionFor({ ...v, at: 'hier' }, st, NOW), null, 'heure illisible');
  });

  test('montre : repos passé ou ±15 s seulement pendant un repos, rien d\'autre', () => {
    reset();
    const resting = run(`watchState(${json(session())}, { ei: 0, si: 0 }, { rest: { endTime: Date.now() + 60000, total: 90 } })`);
    const idle    = run(`watchState(${json(session())}, { ei: 0, si: 0 })`);
    sameJSON(act({ type: 'skipRest' }, resting), { type: 'skipRest' });
    assert.equal(act({ type: 'skipRest' }, idle), null);
    sameJSON(act({ type: 'restAdjust', d: -15 }, resting), { type: 'restAdjust', d: -15 });
    sameJSON(act({ type: 'restAdjust', d: 15 }, resting), { type: 'restAdjust', d: 15 });
    assert.equal(act({ type: 'restAdjust', d: 600 }, resting), null, 'pas de saut arbitraire');
    assert.equal(act({ type: 'restAdjust', d: 15 }, idle), null);
    assert.equal(act({ type: 'finishSession' }, resting), null, 'geste inconnu');
    assert.equal(app.watchActionFor(null, resting, NOW), null);
    assert.equal(app.watchActionFor('validate', resting, NOW), null);
  });

  // ── Montre et Siri : rien avant la fin du démarrage ────────

  test('montre : aucun écouteur ni envoi avant watchBoot (séance pas encore restaurée), puis l\'état part', () => {
    reset();
    ctx.activeSession = null;
    const sent = [], listeners = {};
    ctx.__realWatch = run('Native.watch');
    try {
      ctx.__fakeWatch = { available: true, send: j => sent.push(JSON.parse(j)),
        onAction: fn => { listeners.action = fn; }, onRequest: fn => { listeners.request = fn; } };
      run('Native.watch = __fakeWatch');
      assert.equal(run('watchReady'), false, 'chargement des scripts : pas encore prêt');
      run('syncWatch()');   // persistSession pendant la restauration : rien ne part
      assert.equal(sent.length, 0, 'aucun état envoyé avant le démarrage');
      assert.equal(Object.keys(listeners).length, 0, 'aucun écouteur posé au chargement du script');
      run('watchBoot()');
      assert.ok(listeners.action && listeners.request, 'écouteurs posés au démarrage');
      assert.equal(sent.length, 1, 'premier état envoyé au démarrage');
      assert.equal(sent[0].active, false);
      run('watchBoot()');
      assert.equal(sent.length, 1, 'démarrage une seule fois');
      listeners.request();
      assert.equal(sent.length, 2, 'la montre redemande : état renvoyé même inchangé');
      listeners.action({ type: 'validate', ei: 0, si: 0, at: Date.now() });   // pas de séance : refusé, état renvoyé
      assert.equal(sent.length, 3);
    } finally { run('Native.watch = __realWatch; watchReady = false; watchLastSent = ""'); delete ctx.__fakeWatch; delete ctx.__realWatch; }
  });

  test('siri : aucun écouteur avant siriBoot (séance pas encore restaurée), un seul ensuite', async () => {
    ctx.__realShortcuts = run('Native.shortcuts');
    const listeners = [];
    let takes = 0;
    ctx.__fakeShortcuts = { available: true, onRequest: fn => listeners.push(fn), takeRequest: async () => { takes++; return null; } };
    try {
      run('Native.shortcuts = __fakeShortcuts');
      assert.equal(run('siriReady'), false);
      assert.equal(listeners.length, 0, 'chargement des scripts : la demande reste dans ShortcutInbox');
      await run('siriBoot()');
      assert.equal(listeners.length, 1);
      assert.equal(takes, 1, 'demande laissée avant le lancement prise au démarrage');
      await run('siriBoot()');
      assert.equal(listeners.length, 1, 'démarrage une seule fois');
      await listeners[0]();
      assert.equal(takes, 2, 'app ouverte : la demande est prise à l\'évènement');
    } finally { run('Native.shortcuts = __realShortcuts; siriReady = false'); delete ctx.__fakeShortcuts; delete ctx.__realShortcuts; }
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

  // ── Empreinte de la coquille (mises à jour à chaud) ─────────

  // Une mise à jour à chaud n'est acceptée que par une coquille de même empreinte (js/app/live-update.js) :
  // du Swift écrit mais pas encore dans le projet Xcode ne doit pas la changer, sinon le canal est gelé
  // pour toutes les builds installées jusqu'à la prochaine build.
  test('empreinte : le Swift absent du projet Xcode ne compte pas, celui qui y est compte', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdlf-runtime-'));
    const put = (rel, txt) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), txt); };
    const PBX = 'ios/App/App.xcodeproj/project.pbxproj';
    try {
      put('package-lock.json', JSON.stringify({ packages: { 'node_modules/@capacitor/ios': { version: '7.0.0' } } }));
      put(PBX, '/* AppDelegate.swift in Sources */\n/* RestActivityAttributes.swift in Sources */\n');
      put('ios/App/App/AppDelegate.swift', 'import UIKit');
      put('ios/App/Shared/RestActivityAttributes.swift', 'import ActivityKit');
      const base = runtimeVersion(dir);
      put('ios/App/Shared/CompanionShared.swift', 'enum Companion {}');
      put('ios/App/AppExtras/WatchPlugin.swift', 'import WatchConnectivity');
      put('ios/App/Watch/MDLFWatchApp.swift', 'import SwiftUI');
      put('ios/App/Widgets/NextSessionWidget.swift', 'import WidgetKit');
      assert.equal(runtimeVersion(dir), base, 'Swift préparé hors du projet Xcode : même empreinte');
      put('ios/App/App/AppDelegate.swift', 'import UIKit // modifié');
      const changed = runtimeVersion(dir);
      assert.notEqual(changed, base, 'Swift compilé modifié : nouvelle empreinte');
      put(PBX, fs.readFileSync(path.join(dir, PBX), 'utf8') + '/* WatchPlugin.swift in Sources */\n');
      const added = runtimeVersion(dir);
      assert.notEqual(added, changed, 'ajouté au projet Xcode : nouvelle empreinte');
      put('ios/App/AppExtras/WatchPlugin.swift', 'import WatchConnectivity // modifié');
      assert.notEqual(runtimeVersion(dir), added, 'une fois dans le projet, ses modifications comptent');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('empreinte : ce dépôt n\'a aucun Swift de la montre, du widget ou de Siri dans le projet Xcode', () => {
    // Tant que l'intégration Xcode (docs/WATCH_WIDGETS.md) n'est pas faite, l'empreinte reste celle de la
    // build installée : les mises à jour à chaud continuent de partir.
    const pbx = swift('App.xcodeproj/project.pbxproj');
    for (const d of ['AppExtras', 'Watch', 'Widgets']) {
      for (const f of fs.readdirSync(path.join(ROOT, 'ios/App', d)).filter(f => f.endsWith('.swift'))) {
        assert.ok(!pbx.includes(`${f} in Sources`), `${d}/${f} pas encore compilé`);
      }
    }
    assert.ok(!pbx.includes('CompanionShared.swift in Sources'));
  });

  // ── Noms partagés avec le Swift (non compilé ici) ───────────

  test('natif : modules, évènements et clés identiques côté JS et côté Swift', () => {
    assert.match(swift('AppExtras/WatchPlugin.swift'), /jsName = "MdlfWatch"/);
    assert.match(swift('AppExtras/WatchPlugin.swift'), /notifyListeners\("action"/);
    assert.match(swift('AppExtras/WatchPlugin.swift'), /notifyListeners\("request"/);
    assert.match(swift('AppExtras/WatchPlugin.swift'), /data\["at"\] = action\.at/, 'heure du geste transmise au JS');
    assert.match(swift('AppExtras/WidgetPlugin.swift'), /jsName = "MdlfWidget"/);
    assert.match(swift('AppExtras/ShortcutsPlugin.swift'), /jsName = "MdlfShortcuts"/);
    assert.match(swift('AppExtras/ShortcutsPlugin.swift'), /notifyListeners\("request"/);
    assert.match(swift('AppExtras/StartSessionIntent.swift'), /"startSession"/);
    const shared = swift('Shared/CompanionShared.swift');
    assert.match(shared, /appGroup = "group\.com\.mdlf\.training"/);
    assert.match(shared, new RegExp(`actionMaxAge: TimeInterval = ${run('WATCH_ACTION_MAX_AGE_MS') / 1000}\\b`), 'même âge maximal d\'un geste');
    // Gestes de la montre : ceux que watchActionFor accepte, rien d'autre
    for (const type of ['validate', 'skipRest', 'restAdjust']) assert.match(shared, new RegExp(`case ${type}\\b`));
    // Version de l'état et de l'instantané : la même des deux côtés
    assert.match(shared, new RegExp(`watchStateVersion = ${run('WATCH_VERSION')}\\b`));
    assert.match(shared, new RegExp(`widgetSnapshotVersion = ${run('WIDGET_VERSION')}\\b`));
    // Pas encore dans le projet Xcode : la build actuelle ne change pas (docs/WATCH_WIDGETS.md)
    assert.doesNotMatch(swift('App.xcodeproj/project.pbxproj'), /WatchPlugin\.swift|NextSessionWidget\.swift/);
  });
}
