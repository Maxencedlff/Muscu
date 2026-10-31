// Empreinte native (« runtime ») d'une coquille de l'app : une mise à jour à chaud du contenu web n'est
// appliquée que dans une app dont la coquille a la même empreinte (IOS.md, « Mises à jour à chaud »).
//
// Une empreinte par plateforme : la coquille iOS et la coquille Android n'ont ni le même code natif ni
// les mêmes modules. Conséquences voulues :
//  - l'empreinte iOS ne dépend de rien d'Android (dossier android/, module @capacitor/android) :
//    préparer ou modifier Android ne casse jamais les mises à jour à chaud des iPhone ;
//  - l'empreinte Android commence par « android- » : un paquet construit pour iOS (manifeste publié
//    par ota.yml) n'est jamais appliqué sur Android, et inversement (docs/ANDROID.md).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const PLATFORMS = {
  ios: {
    files: ['capacitor.config.json', 'ios/App/App/Info.plist', 'ios/App/App/App.entitlements',
      'ios/App/App.xcodeproj/project.pbxproj', 'ios/App/RestActivity/Info.plist'],
    // Code Swift de l'app, partagé, et de l'extension Live Activity (RestActivity)
    codeDirs: ['ios/App/App', 'ios/App/Shared', 'ios/App/RestActivity'],
    codeExt: ['.swift'],
    recursive: false,
    otherShell: '@capacitor/android',
    prefix: '',
  },
  android: {
    files: ['capacitor.config.json', 'android/build.gradle', 'android/variables.gradle',
      'android/app/build.gradle', 'android/app/src/main/AndroidManifest.xml'],
    // Modules maison (Kotlin, Java) et ressources (icônes, thème, règles de sauvegarde)
    codeDirs: ['android/app/src/main/java', 'android/app/src/main/res'],
    codeExt: null,
    recursive: true,
    // Fichiers générés par « cap sync » (non suivis par git) : absents d'un dépôt tout juste cloné
    generated: ['android/app/src/main/res/xml/config.xml'],
    otherShell: '@capacitor/ios',
    prefix: 'android-',
  },
};

function listFiles(root, dir, { codeExt, recursive }) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .flatMap(e => {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) return recursive ? listFiles(root, rel, { codeExt, recursive }) : [];
      return !codeExt || codeExt.some(x => e.name.endsWith(x)) ? [rel] : [];
    });
}

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
  const code = spec.codeDirs.flatMap(d => listFiles(root, d, spec)).filter(rel => !spec.generated?.includes(rel));
  for (const rel of [...spec.files, ...code]) {
    const p = path.join(root, rel);
    if (fs.existsSync(p)) h.update(rel + '\0' + fs.readFileSync(p));
  }
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  h.update(nativeModules(lock, platform).join('\n'));
  return spec.prefix + h.digest('hex').slice(0, 16);
}
