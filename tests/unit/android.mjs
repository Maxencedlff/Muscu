// ═══════════════════════════════════════════════════════════
//  Tests unitaires de la préparation Android (docs/ANDROID.md) :
//  - empreintes natives par plateforme : l'iOS ne bouge pas quand Android change ;
//  - pont natif (js/platform/native.js) dans une coquille Android simulée, et iOS inchangé ;
//  - cohérence des modules Kotlin avec le pont, avec les modules Swift et avec le manifeste.
//  Chargés par run.mjs (même mini-exécuteur). Rien n'est compilé ici : pas de SDK Android requis.
// ═══════════════════════════════════════════════════════════

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runtimeVersion, nativeModules } from '../../scripts/runtime.mjs';

const KOTLIN = 'android/app/src/main/java/com/mdlf/training';

export default function ({ test, assert, nativeContext, ROOT }) {
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
    assert.deepEqual(health, swiftMethods('HealthPlugin.swift'));
    for (const m of bridgeCalls('Health')) assert.ok(health.includes(m), `MdlfHealth.${m} manque sur Android`);
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
}
