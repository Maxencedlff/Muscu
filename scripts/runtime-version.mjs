// Empreinte native (« runtime ») d'une coquille de l'app, utilisée par scripts/build-web.mjs (IOS.md,
// « Mises à jour à chaud ») : une mise à jour à chaud n'est appliquée que dans une app dont la coquille a
// la même empreinte (js/app/live-update.js, même principe que le runtimeVersion d'Expo). Elle doit donc
// changer avec tout ce qui change le binaire, et SEULEMENT avec ça : une empreinte qui bouge sans nouvelle
// build gèle les mises à jour à chaud.
//
// Une empreinte par plateforme : la coquille iOS et la coquille Android n'ont ni le même code natif ni les
// mêmes modules. Conséquences voulues :
//  - l'empreinte iOS ne dépend de rien d'Android (dossier android/, module @capacitor/android) :
//    préparer ou modifier Android ne casse jamais les mises à jour à chaud des iPhone ;
//  - l'empreinte Android commence par « android- » : un paquet construit pour iOS (manifeste publié par
//    ota.yml) n'est jamais appliqué sur Android, et inversement (docs/ANDROID.md) ;
//  - côté iOS, un fichier Swift ne compte que s'il est compilé (référencé dans le projet Xcode) : le code de
//    la montre, du widget et de Siri préparé avant son intégration ne change rien (docs/WATCH_WIDGETS.md).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const PBXPROJ = 'ios/App/App.xcodeproj/project.pbxproj';
// Fichiers de la coquille iOS qui entrent dans l'empreinte
export const RUNTIME_INPUTS = ['capacitor.config.json', 'ios/App/App/Info.plist', 'ios/App/App/App.entitlements',
  PBXPROJ, 'ios/App/RestActivity/Info.plist'];
// Dossiers du code Swift : app, partagé, Live Activity (RestActivity), et Apple Watch, widget et Siri
// (AppExtras, Watch, Widgets : docs/WATCH_WIDGETS.md)
export const SWIFT_DIRS = ['ios/App/App', 'ios/App/Shared', 'ios/App/RestActivity', 'ios/App/AppExtras', 'ios/App/Watch', 'ios/App/Widgets'];
// Fichiers et dossiers de la coquille Android
export const ANDROID_INPUTS = ['capacitor.config.json', 'android/build.gradle', 'android/variables.gradle',
  'android/app/build.gradle', 'android/app/src/main/AndroidManifest.xml'];
// Modules maison (Kotlin, Java) et ressources (icônes, thème, règles de sauvegarde), tout le contenu
const ANDROID_DIRS = ['android/app/src/main/java', 'android/app/src/main/res'];
// Fichiers générés par « cap sync » (non suivis par git) : absents d'un dépôt tout juste cloné
const ANDROID_GENERATED = ['android/app/src/main/res/xml/config.xml'];

// Un fichier Swift ne compte que s'il est compilé, c'est-à-dire référencé dans une phase « Sources » du
// projet Xcode (« Nom.swift in Sources »). Du Swift écrit mais pas encore ajouté au projet (code natif
// préparé sur une branche avant la build) ne change donc pas l'empreinte ; l'ajouter au projet modifie
// project.pbxproj, qui est lui-même dans l'empreinte. Sans projet lisible : tout le Swift compte.
function compiledSwift(root) {
  let pbx = null;
  try { pbx = fs.readFileSync(path.join(root, PBXPROJ), 'utf8'); } catch {}
  return SWIFT_DIRS.filter(d => fs.existsSync(path.join(root, d))).flatMap(d =>
    fs.readdirSync(path.join(root, d)).filter(f => f.endsWith('.swift')).sort()
      .filter(f => pbx === null || pbx.includes(`${f} in Sources`))
      .map(f => `${d}/${f}`));
}

// Tous les fichiers d'un dossier, sous-dossiers compris, dans un ordre stable
function allFiles(root, dir) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .flatMap(e => (e.isDirectory() ? allFiles(root, `${dir}/${e.name}`) : [`${dir}/${e.name}`]));
}

const PLATFORMS = {
  ios: {
    inputs: root => [...RUNTIME_INPUTS, ...compiledSwift(root)],
    otherShell: '@capacitor/android',
    prefix: '',
  },
  android: {
    inputs: root => [...ANDROID_INPUTS,
      ...ANDROID_DIRS.flatMap(d => allFiles(root, d)).filter(rel => !ANDROID_GENERATED.includes(rel))],
    otherShell: '@capacitor/ios',
    prefix: 'android-',
  },
};

// Modules natifs : versions exactes installées (package-lock), sans la CLI ni la coquille de l'autre plateforme
export function nativeModules(lock, platform) {
  const other = PLATFORMS[platform].otherShell;
  return Object.entries(lock.packages || {})
    .filter(([k]) => /node_modules\/@(capacitor|capgo|capacitor-community)\//.test(k) && !k.includes('/cli')
      && k !== `node_modules/${other}`)
    .map(([k, v]) => `${k}@${v.version}`).sort();
}

export function runtimeVersion(root, platform = 'ios') {
  const spec = PLATFORMS[platform];
  if (!spec) throw new Error(`Plateforme inconnue : ${platform}`);
  const h = crypto.createHash('sha256');
  for (const rel of spec.inputs(root)) {
    const p = path.join(root, rel);
    if (fs.existsSync(p)) h.update(rel + '\0' + fs.readFileSync(p));
  }
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  h.update(nativeModules(lock, platform).join('\n'));
  return spec.prefix + h.digest('hex').slice(0, 16);
}
