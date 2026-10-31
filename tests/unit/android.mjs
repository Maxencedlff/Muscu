// ═══════════════════════════════════════════════════════════
//  Tests unitaires de la préparation Android (docs/ANDROID.md) :
//  - empreintes natives par plateforme : l'iOS ne bouge pas quand Android change ;
//  - pont natif (js/platform/native.js) dans une coquille Android simulée, et iOS inchangé ;
//  - cohérence des modules Kotlin avec le pont, avec les modules Swift et avec le manifeste ;
//  - Santé : le web (écrit pour iOS) face aux réponses de Health Connect, refus partiels compris ;
//  - lecture des nombres en Kotlin (horodatages longs) : jamais getDouble / getLong.
//  Chargés par run.mjs (même mini-exécuteur). Rien n'est compilé ici : pas de SDK Android requis.
// ═══════════════════════════════════════════════════════════

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runtimeVersion, nativeModules } from '../../scripts/runtime-version.mjs';

const KOTLIN = 'android/app/src/main/java/com/mdlf/training';

export default function ({ test, assert, run, app, reset, nativeContext, ROOT }) {
  const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

  // Petit dépôt jetable : un fichier Swift, un manifeste de modules, et (au besoin) Android
  const fakeRepo = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdlf-runtime-'));
    const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
    put('capacitor.config.json', '{"appId":"com.mdlf.training"}');
    put('ios/App/App/HealthPlugin.swift', 'import HealthKit');
    put('package-lock.json', JSON.stringify({ packages: {
      'node_modules/@capacitor/core': { version: '8.5.3' },
      'node_modules/@capacitor/ios': { version: '8.5.3' },
      'node_modules/@capacitor/cli': { version: '8.5.3' },
    } }));
    return { dir, put, done: () => fs.rmSync(dir, { recursive: true, force: true }) };
  };

  test('android : empreinte iOS inchangée par le dossier android/ et par @capacitor/android', () => {
    const repo = fakeRepo();
    try {
      const before = runtimeVersion(repo.dir, 'ios');
      assert.match(before, /^[0-9a-f]{16}$/);
      repo.put('android/app/src/main/java/com/mdlf/training/HealthPlugin.kt', 'class HealthPlugin');
      repo.put('android/app/src/main/AndroidManifest.xml', '<manifest/>');
      const lock = JSON.parse(fs.readFileSync(path.join(repo.dir, 'package-lock.json'), 'utf8'));
      lock.packages['node_modules/@capacitor/android'] = { version: '8.5.3' };
      repo.put('package-lock.json', JSON.stringify(lock));
      assert.equal(runtimeVersion(repo.dir, 'ios'), before, 'préparer Android ne doit pas bloquer les mises à jour à chaud des iPhone');
      // Un vrai changement iOS change toujours l'empreinte iOS
      repo.put('ios/App/App/HealthPlugin.swift', 'import HealthKit // modifié');
      assert.notEqual(runtimeVersion(repo.dir, 'ios'), before);
    } finally { repo.done(); }
  });

  test('android : empreinte Android propre (préfixe, suit le Kotlin et les ressources, ignore iOS)', () => {
    const repo = fakeRepo();
    try {
      repo.put('android/app/src/main/java/com/mdlf/training/StorePlugin.kt', 'class StorePlugin');
      const a = runtimeVersion(repo.dir, 'android');
      assert.match(a, /^android-[0-9a-f]{16}$/, 'jamais égale à une empreinte iOS : un paquet iOS n\'est jamais appliqué sur Android');
      repo.put('ios/App/App/HealthPlugin.swift', 'import HealthKit // modifié');
      assert.equal(runtimeVersion(repo.dir, 'android'), a, 'le Swift ne compte pas pour Android');
      repo.put('android/app/src/main/java/com/mdlf/training/StorePlugin.kt', 'class StorePlugin // modifié');
      const b = runtimeVersion(repo.dir, 'android');
      assert.notEqual(b, a, 'Kotlin modifié : nouvelle coquille');
      repo.put('android/app/src/main/res/xml/config.xml', '<widget/>');
      assert.equal(runtimeVersion(repo.dir, 'android'), b, 'fichier généré par cap sync ignoré (même empreinte sur un clone neuf)');
      repo.put('android/app/src/main/res/values/colors.xml', '<resources/>');
      assert.notEqual(runtimeVersion(repo.dir, 'android'), b, 'ressource modifiée : nouvelle coquille');
      assert.throws(() => runtimeVersion(repo.dir, 'windows'), /Plateforme inconnue/);
    } finally { repo.done(); }
  });

  test('android : modules natifs comptés par plateforme (sans la CLI ni la coquille de l\'autre)', () => {
    const lock = { packages: {
      'node_modules/@capacitor/android': { version: '8.5.3' }, 'node_modules/@capacitor/ios': { version: '8.5.3' },
      'node_modules/@capacitor/cli': { version: '8.5.3' }, 'node_modules/@capgo/capacitor-updater': { version: '8.53.0' },
      'node_modules/@supabase/supabase-js': { version: '2.118.0' },
    } };
    assert.deepEqual(nativeModules(lock, 'ios'), ['node_modules/@capacitor/ios@8.5.3', 'node_modules/@capgo/capacitor-updater@8.53.0']);
    assert.deepEqual(nativeModules(lock, 'android'), ['node_modules/@capacitor/android@8.5.3', 'node_modules/@capgo/capacitor-updater@8.53.0']);
  });

  test('android : @capacitor/android à la même version exacte que @capacitor/core et @capacitor/ios', () => {
    const lock = JSON.parse(read('package-lock.json')).packages;
    const v = name => lock[`node_modules/@capacitor/${name}`]?.version;
    assert.ok(v('android'), '@capacitor/android installé');
    assert.equal(v('android'), v('core'));
    assert.equal(v('android'), v('ios'));
    assert.equal(JSON.parse(read('package.json')).dependencies['@capacitor/android'], v('android'), 'version figée (sinon npm monte aussi @capacitor/core)');
  });

  // ── Pont natif ────────────────────────────────────────────

  test('android : pont natif (plateforme, Health Connect, pas d\'Apple Music)', () => {
    const { Native } = nativeContext({ platform: 'android' });
    assert.equal(Native.isNative, true);
    assert.equal(Native.platform, 'android');
    assert.equal(Native.health.name, 'Health Connect');
    assert.equal(Native.music.available, false);
    assert.equal(Native.account.available, false, 'pas de module de compte Android pour l\'instant : rubrique Compte masquée');
  });

  test('android : iOS et navigateur inchangés (plateforme, Apple Santé, Apple Music)', () => {
    const ios = nativeContext({ platform: 'ios' }).Native;
    assert.equal(ios.platform, 'ios');
    assert.equal(ios.health.name, 'Apple Santé');
    assert.equal(ios.music.available, true);
    const web = nativeContext({ native: false }).Native;
    assert.equal(web.platform, 'web');
    assert.equal(web.music.available, false);
  });

  test('android : copie de sécurité dans le dossier privé de l\'app (sauvegarde Google), jamais iCloud', async () => {
    const { Native, calls } = nativeContext({ platform: 'android' });
    assert.equal(await Native.boot(), false, 'rien à restaurer');
    assert.ok(!calls.some(c => c[0] === 'cloudLoad'), 'aucune attente d\'iCloud au démarrage');
    Native.backup(JSON.stringify({ history: [{ id: 1 }] }));
    const writes = calls.filter(c => c[0] === 'writeFile');
    assert.deepEqual(writes.map(c => c[2]), ['DATA']);
    assert.ok(!calls.some(c => c[0] === 'cloudSave'));
  });

  test('android : réinstallation, la copie restaurée par Google est remise en place', async () => {
    const json = JSON.stringify({ history: [{ id: 1 }, { id: 2 }] });
    const ctx = nativeContext({ platform: 'android', fileData: json });
    assert.equal(await ctx.Native.boot(), true);
    assert.equal(ctx.storage.getItem('ppl_v2'), json);
    assert.ok(ctx.isReloaded());
  });

  test('android : iOS garde ses Documents et sa copie iCloud', async () => {
    const { Native, calls } = nativeContext({ platform: 'ios' });
    await Native.boot();
    assert.ok(calls.some(c => c[0] === 'cloudLoad'));
    Native.backup(JSON.stringify({ history: [{ id: 1 }] }));
    assert.deepEqual(calls.filter(c => c[0] === 'writeFile').map(c => c[2]), ['DOCUMENTS']);
    assert.ok(calls.some(c => c[0] === 'cloudSave'));
  });

  // ── Modules Kotlin ────────────────────────────────────────

  const kotlin = file => read(`${KOTLIN}/${file}`);
  const kotlinName = text => text.match(/@CapacitorPlugin\(\s*name = "(\w+)"/)?.[1];
  const kotlinMethods = text => [...text.matchAll(/@PluginMethod\s+fun (\w+)\(/g)].map(m => m[1]).sort();
  const swiftMethods = file => [...read(`ios/App/App/${file}`).matchAll(/CAPPluginMethod\(name: "(\w+)"/g)].map(m => m[1]).sort();
  const bridgeCalls = variable => [...new Set([...read('js/platform/native.js').matchAll(new RegExp(`\\b${variable}\\.(\\w+)\\(`, 'g'))].map(m => m[1]))]
    .filter(m => m !== 'addListener').sort();

  test('android : chaque module Kotlin est enregistré dans MainActivity, sous le nom du module iOS', () => {
    const registered = [...read(`${KOTLIN}/MainActivity.java`).matchAll(/registerPlugin\((\w+)\.class\)/g)].map(m => m[1]).sort();
    const files = fs.readdirSync(path.join(ROOT, KOTLIN)).filter(f => f.endsWith('Plugin.kt')).map(f => f.replace('.kt', '')).sort();
    assert.deepEqual(registered, files);
    const names = files.map(f => kotlinName(kotlin(`${f}.kt`))).sort();
    assert.deepEqual(names, ['MdlfHealth', 'MdlfLiveActivity', 'MdlfStore']);
    const bridge = read('js/platform/native.js');
    for (const n of ['MdlfHealth', 'MdlfLiveActivity']) assert.ok(bridge.includes(`plugin('${n}')`), `${n} branché dans le pont`);
  });

  test('android : Santé et repos ont les mêmes méthodes qu\'iOS et tout ce que le pont appelle', () => {
    const health = kotlinMethods(kotlin('HealthPlugin.kt'));
    // iOS seulement (build unique du 31/10) : le pont les attrape en UNIMPLEMENTED et se replie (une
    // séance en un seul entraînement « Musculation » par saveWorkout ; aucun sommeil lu)
    const IOS_ONLY = ['saveWorkouts', 'sleep'];
    assert.deepEqual(health, swiftMethods('HealthPlugin.swift').filter(m => !IOS_ONLY.includes(m)));
    const bridge = read('js/platform/native.js');
    for (const m of IOS_ONLY) {
      assert.match(bridge, new RegExp(`await Health\\.${m}\\([^]{0,200}?catch \\(e\\) \\{ return e\\?\\.code === 'UNIMPLEMENTED'`), `Health.${m} : pas de repli UNIMPLEMENTED dans le pont`);
    }
    for (const m of bridgeCalls('Health')) assert.ok(health.includes(m) || IOS_ONLY.includes(m), `MdlfHealth.${m} manque sur Android`);
    const rest = kotlinMethods(kotlin('LiveActivityPlugin.kt'));
    assert.deepEqual(rest, swiftMethods('LiveActivityPlugin.swift'));
    for (const m of bridgeCalls('LiveActivity')) assert.ok(rest.includes(m), `MdlfLiveActivity.${m} manque sur Android`);
  });

  test('android : MdlfStore suit le contrat de StorePlugin.swift (branche payant)', () => {
    const store = kotlin('StorePlugin.kt');
    assert.deepEqual(kotlinMethods(store), ['current', 'finish', 'products', 'purchase', 'redeemCode', 'restore', 'status']);
    assert.ok(store.includes('"com.mdlf.training.pro.monthly", "com.mdlf.training.pro.yearly"'), 'mêmes abonnements, même ordre');
    assert.ok(store.includes('GIFT_ID = "com.mdlf.training.access.gift"'));
    assert.match(store, /notifyListeners\("transaction", payload, true\)/);
    assert.match(store, /notifyListeners\("change", payload, true\)/);
    // Jamais de droit décidé dans l'app : aucun appel réseau, aucune clé
    assert.doesNotMatch(store, /https?:\/\/(?!play\.google\.com\/redeem)/);
  });

  test('android : manifeste = exactement les autorisations Health Connect utilisées par le module', () => {
    const PERM = { ExerciseSessionRecord: 'EXERCISE', ActiveCaloriesBurnedRecord: 'ACTIVE_CALORIES_BURNED', WeightRecord: 'WEIGHT', DistanceRecord: 'DISTANCE' };
    const used = [...kotlin('HealthPlugin.kt').matchAll(/get(Read|Write)Permission\((\w+)::class\)/g)]
      .map(([, rw, cls]) => { assert.ok(PERM[cls], `type ${cls} sans autorisation connue`); return `android.permission.health.${rw.toUpperCase()}_${PERM[cls]}`; });
    const manifest = read('android/app/src/main/AndroidManifest.xml');
    const declared = [...manifest.matchAll(/uses-permission android:name="(android\.permission\.health\.\w+)"/g)].map(m => m[1]);
    assert.deepEqual([...new Set(declared)].sort(), [...new Set(used)].sort());
    assert.match(manifest, /androidx\.health\.ACTION_SHOW_PERMISSIONS_RATIONALE/, 'politique de confidentialité jusqu\'à Android 13');
    assert.match(manifest, /android\.intent\.action\.VIEW_PERMISSION_USAGE[\s\S]*HEALTH_PERMISSIONS/, 'et à partir d\'Android 14');
    assert.match(manifest, /<package android:name="com\.google\.android\.apps\.healthdata" \/>/);
  });

  test('android : sauvegarde Google = le fichier de copie du pont natif, rien d\'autre', () => {
    const file = read('js/platform/native.js').match(/BACKUP_FILE\s*=\s*'([^']+)'/)[1];
    for (const rel of ['android/app/src/main/res/xml/data_extraction_rules.xml', 'android/app/src/main/res/xml/backup_rules.xml']) {
      const includes = [...read(rel).matchAll(/<include domain="(\w+)" path="([^"]+)"/g)].map(m => `${m[1]}:${m[2]}`);
      assert.ok(includes.length > 0 && includes.every(i => i === `file:${file}`), rel);
    }
    assert.doesNotMatch(read('android/app/src/main/res/xml/file_paths.xml'), /external-path/, 'stockage partagé jamais exposé');
  });

  test('android : icônes et écran de démarrage de la marque (adaptative + monochrome, fond noir pur)', () => {
    const res = 'android/app/src/main/res';
    const adaptive = read(`${res}/mipmap-anydpi-v26/ic_launcher.xml`);
    assert.match(adaptive, /<monochrome android:drawable="@mipmap\/ic_launcher_monochrome"\/>/, 'icône thématique d\'Android 13');
    for (const d of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
      for (const f of [`mipmap-${d}/ic_launcher_foreground.png`, `mipmap-${d}/ic_launcher_monochrome.png`, `drawable-${d}/ic_stat_mdlf.png`]) {
        assert.ok(fs.existsSync(path.join(ROOT, res, f)), f);
      }
      assert.ok(!fs.existsSync(path.join(ROOT, res, `mipmap-${d}/ic_launcher.png`)), 'image d\'exemple de Capacitor retirée');
    }
    assert.match(read(`${res}/values/colors.xml`), /<color name="mdlf_black">#000000<\/color>/);
    const styles = read(`${res}/values/styles.xml`);
    assert.match(styles, /windowSplashScreenBackground">@color\/mdlf_black/);
    assert.match(styles, /android:windowBackground">@color\/mdlf_black/);
  });

  // ── Nombres envoyés par le web ────────────────────────────
  // PluginCall.getDouble (Capacitor 8.5.3) rend null pour un Long, getLong pour tout ce qui n'est pas un
  // Long : un horodatage Date.now() (Long dans org.json) serait perdu, ou un petit entier pour getLong.
  // Pas de test instrumenté sur Android : la règle est contrôlée dans le source (CallArgs.kt).

  test('android : nombres lus sans getDouble / getLong / getFloat (horodatages longs perdus)', () => {
    const files = fs.readdirSync(path.join(ROOT, KOTLIN)).filter(f => f.endsWith('.kt'));
    for (const f of files) {
      const text = kotlin(f);
      assert.doesNotMatch(text, /\.get(Double|Long|Float)\(/, `${f} : lire les nombres avec epochMillis / number (CallArgs.kt)`);
      // getInt rend null pour un Long : seulement pour de petits nombres (jours)
      for (const [, key] of text.matchAll(/\.getInt\("(\w+)"/g)) assert.equal(key, 'days', `${f} : getInt("${key}")`);
    }
    const args = kotlin('CallArgs.kt');
    assert.match(args, /fun PluginCall\.epochMillis\(key: String\): Long\?[\s\S]*?data\.optDouble\(key, Double\.NaN\)/);
    assert.match(args, /fun PluginCall\.number\(key: String, fallback: Double\): Double[\s\S]*?data\.optDouble\(key, Double\.NaN\)/);
    const health = kotlin('HealthPlugin.kt');
    assert.match(health, /epochMillis\("start"\)/);
    assert.match(health, /epochMillis\("end"\)/);
    assert.match(kotlin('LiveActivityPlugin.kt'), /epochMillis\("endTime"\)/);
  });

  test('android : le web envoie bien des horodatages entiers longs (cas que getDouble perdait)', async () => {
    // Ce que reçoit le module : JSON.stringify d'un Date.now() n'a pas de virgule, au-delà de 2^31
    const sent = [];
    const { Native } = nativeContext({ platform: 'android', plugins: { MdlfHealth: { saveWorkout: async o => { sent.push(JSON.stringify(o)); return { saved: true }; } } } });
    const end = new Date(2026, 9, 31, 19).getTime();
    assert.equal(await Native.health.saveWorkout({ start: end - 3_600_000, end, kcal: 420 }), true);
    const [json] = sent;
    assert.match(json, /"start":\d{13},"end":\d{13},"kcal":420/);
    assert.ok(end > 2 ** 31, 'Long pour org.json');
  });

  // ── Santé : sémantique des autorisations ──────────────────
  // Health Connect simulé avec la logique de HealthPlugin.kt : chaque ensemble (poids et écriture ;
  // courses et vélo) n'est demandé qu'une fois, la fenêtre n'apparaît que pour un ensemble jamais
  // demandé, authorizationStatus ne porte que sur les courses. choose : ce que l'utilisateur accorde
  // dans la fenêtre (parmi ce qui est proposé). Branché derrière le vrai pont Android (native.js).
  const WRITE = ['write:session', 'write:kcal'], WEIGHT = ['read:weight'], WORKOUTS = ['read:session', 'read:distance'];
  const sameWindows = (a, b, msg) => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);
  function healthConnect(choose) {
    const hc = { granted: new Set(), asked: { base: false, workouts: false }, windows: [], reads: 0 };
    // HealthConnectClient.readRecords : SecurityException si la lecture n'est pas accordée (doc Android),
    // que launchCall transforme en reject. Le module vérifie donc l'autorisation avant de lire.
    const readRecords = (perm, records) => {
      hc.reads++;
      if (!hc.granted.has(perm)) throw Object.assign(new Error('SecurityException'), { code: 'SECURITY' });
      return records;
    };
    const answer = () => ({ available: true, workouts: hc.granted.has('write:session'),
      workoutsRead: WORKOUTS.every(p => hc.granted.has(p)) });
    const impl = {
      requestAuthorization: async ({ workouts = true } = {}) => {
        const toAsk = [...(hc.asked.base ? [] : [...WRITE, ...WEIGHT]), ...(workouts && !hc.asked.workouts ? WORKOUTS : [])];
        if (toAsk.every(p => hc.granted.has(p))) return answer();
        hc.windows.push(toAsk);
        for (const p of choose(toAsk)) hc.granted.add(p);
        hc.asked.base = true;
        if (workouts) hc.asked.workouts = true;
        return answer();
      },
      authorizationStatus: async () => ({ available: true,
        request: hc.asked.workouts || WORKOUTS.every(p => hc.granted.has(p)) ? 'unnecessary' : 'shouldRequest' }),
      workouts: async () => ({ workouts: WORKOUTS.every(p => hc.granted.has(p))
        ? readRecords('read:session', [{ id: 'run1', activity: 'running', start: 1, end: 2, duration: 1, km: 5, source: 'Strava', productType: '', indoor: false, own: false }]) : [] }),
      bodyMass: async () => ({ samples: WEIGHT.every(p => hc.granted.has(p)) ? readRecords('read:weight', [{ date: 1, kg: 80 }]) : [] }),
      saveWorkout: async () => ({ saved: hc.granted.has('write:session') }),
    };
    // Comme registerPlugin de Capacitor : une méthode que le module Kotlin n'a pas (saveWorkouts, sleep,
    // iOS seulement) est rejetée avec le code UNIMPLEMENTED
    hc.plugin = new Proxy(impl, { get: (t, m) => (m in t || typeof m !== 'string' || m === 'then' ? t[m]
      : async () => { throw Object.assign(new Error(`"MdlfHealth.${m}()" is not implemented on android`), { code: 'UNIMPLEMENTED' }); }) });
    hc.Native = nativeContext({ platform: 'android', plugins: { MdlfHealth: hc.plugin } }).Native;
    return hc;
  }
  // Le contexte de l'app (apple-services.js) parle au pont Android simulé ; dialogues et dessins notés
  function withAndroidHealth(hc, fn) {
    app.__androidHealth = hc.Native.health;
    app.__dialogs = [];
    run(`var __savedHealth = Native.health, __savedNative = Native.isNative;
      Native.health = __androidHealth; Native.isNative = true;
      globalThis.render = () => {}; globalThis.dialog = async o => { __dialogs.push(o); };
      healthAuthAsked = null; resetWorkoutsAuth(); workoutCache = emptyWorkoutCache();`);
    const restore = () => run(`Native.health = __savedHealth; Native.isNative = __savedNative; delete globalThis.render; delete globalThis.dialog;
      data.healthOn = false; healthAuthAsked = null; resetWorkoutsAuth(); workoutCache = emptyWorkoutCache();
      weightCache = { at: 0, samples: [], failed: false };`);
    return Promise.resolve().then(fn).finally(restore);
  }
  const launch = () => run('healthAuthAsked = null; resetWorkoutsAuth(); workoutCache = emptyWorkoutCache(); weightCache = { at: 0, samples: [], failed: false }');

  test('android Santé : poids refusé, courses accordées, les courses sont lues et rien n\'est redemandé', async () => {
    reset();
    const hc = healthConnect(asked => asked.filter(p => p !== 'read:weight'));
    await withAndroidHealth(hc, async () => {
      await run(`actionHandlers.get('setting-health')()`);
      assert.equal(run('data.healthOn'), true, 'écriture accordée : Santé activé');
      assert.equal(hc.windows.length, 1, 'une seule fenêtre, tout proposé ensemble');
      assert.equal(await run('loadHealthWorkouts()'), true, 'courses lues malgré le refus du poids');
      assert.equal(run('workoutCache.list.length'), 1);
      assert.doesNotMatch(run('renderHealthWorkoutsCell()'), /data-action/, 'pas de cellule « Autorise » qui ne ferait plus rien');
      // Lancement suivant : fin de séance, envoi de l'historique, lecture du poids
      launch();
      run(`data.history = [{ id: 'h1', date: ${Date.now()}, duration: 3600000, programme: 'ppl', category: 'push', exercises: [{ name: 'Développé couché', sets: [{ weight: 80, reps: 8 }] }] }]`);
      // Une série de travail : une séance sans série n'est plus écrite dans Santé (build unique, health-export.js)
      await run('syncWorkoutToHealth(data.history[0])');
      assert.equal(run('data.history[0].healthSaved'), true);
      await run('bodyMassSamples()');
      // Poids refusé : liste vide comme iOS (« Aucune pesée lue »), jamais « Santé n'a pas répondu »
      // à réessayer sans fin, et la lecture vide est gardée le temps du cache
      assert.equal(run('weightCache.failed'), false, 'refus du poids : pas un échec de lecture');
      assert.doesNotMatch(run('renderBodyWeightCell()'), /retry-body-weight/, 'pas de cellule « réessayer » morte');
      assert.match(run('renderBodyWeightCell()'), /Aucune pesée|Lecture/);
      const reads = hc.reads;
      await run('bodyMassSamples()');
      assert.equal(hc.reads, reads, 'lecture vide gardée : Health Connect pas relu à chaque appel');
      await run('sendHistoryToHealth()');
      assert.equal(hc.windows.length, 1, 'aucune fenêtre Health Connect en plein bilan ni au lancement');
      assert.equal(app.__dialogs.length, 0);
    });
  });

  test('android Santé : courses refusées, un toucher sur « Autorise » explique où autoriser', async () => {
    reset();
    const hc = healthConnect(asked => asked.filter(p => !p.startsWith('read:') || p === 'read:weight'));
    await withAndroidHealth(hc, async () => {
      // Santé activé dans une donnée restaurée : seuls le poids et l'écriture sont demandés au lancement
      run('data.healthOn = true');
      await run('ensureHealthAuth()');
      sameWindows(hc.windows, [[...WRITE, ...WEIGHT]]);
      assert.equal(await run('workoutsAuthStatus()'), 'shouldRequest');
      assert.match(run('renderHealthWorkoutsCell()'), /data-action="health-workouts-auth"/);
      await run(`actionHandlers.get('health-workouts-auth')()`);
      sameWindows(hc.windows, [[...WRITE, ...WEIGHT], WORKOUTS], 'courses demandées seules, une fois');
      assert.equal(app.__dialogs.length, 1, 'refus : le toucher répond par un message');
      assert.equal(app.__dialogs[0].message, run('HEALTH_TEXT.refused'));
      assert.doesNotMatch(run('renderHealthWorkoutsCell()'), /data-action/, 'déjà demandé : plus de cellule morte');
      // Lancement suivant : jamais de fenêtre redemandée
      launch();
      await run('ensureHealthAuth()');
      assert.equal(await run('workoutsAuthStatus()'), 'unnecessary');
      assert.equal(await run('loadHealthWorkouts()'), false, 'lecture tentée, rien d\'accordé : liste vide');
      assert.equal(hc.windows.length, 2);
    });
  });

  test('android Santé : « Aucune pesée lue » indique le chemin Health Connect, pas les Réglages de l\'iPhone', () => {
    const src = read('js/features/apple-services.js');
    const [android, ios] = src.match(/const HEALTH_TEXT = [\s\S]*?\n};/)[0].split(/\n} : \{/);
    assert.match(android, /noWeight: '[^']*Health Connect › Autorisations des applications[^']*'/);
    assert.doesNotMatch(android, /iPhone/);
    assert.match(ios, /noWeight: '[^']*Réglages de l\\'iPhone/);
    const fill = src.match(/async function fillWeightGroup\(\)[\s\S]*?\n}\n/)[0];
    assert.match(fill, /Aucune pesée lue[\s\S]*\$\{HEALTH_TEXT\.noWeight\}/);
  });

  test('android Santé : HealthPlugin.kt suit la sémantique simulée ci-dessus', () => {
    const health = kotlin('HealthPlugin.kt');
    const body = name => health.match(new RegExp(`fun ${name}\\([\\s\\S]*?\\n    }\\n`))?.[0] || '';
    const status = body('authorizationStatus');
    assert.match(status, /asked\(KEY_WORKOUTS\)/, '« unnecessary » = déjà demandé, comme iOS');
    assert.doesNotMatch(status, /weightPermissions|writePermissions/, 'le refus du poids ne bloque pas les courses');
    // readRecords lève une SecurityException sans autorisation : chaque lecture la vérifie d'abord
    assert.match(body('bodyMass'), /getGrantedPermissions\(\)[\s\S]*containsAll\(weightPermissions\)[\s\S]*readRecords/, 'poids refusé : liste vide, pas un échec');
    assert.match(body('workouts'), /getGrantedPermissions\(\)[\s\S]*containsAll\(workoutPermissions\)[\s\S]*readRecords/);
    const request = body('requestAuthorization');
    assert.match(request, /asked\(KEY_BASE\)/);
    assert.match(request, /asked\(KEY_WORKOUTS\)/);
    assert.match(request, /\.put\("workoutsRead"|answer\(granted\)/);
    const result = body('onPermissionsResult');
    assert.match(result, /putBoolean\(KEY_BASE, true\)/, 'réponse retenue');
    assert.match(result, /putBoolean\(KEY_WORKOUTS, true\)/);
    assert.match(health, /\.put\("workoutsRead", granted\.containsAll\(workoutPermissions\)\)/);
  });
}
