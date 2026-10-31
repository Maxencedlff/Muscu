// Empreinte « runtime » de la coquille iOS (utilisée par scripts/build-web.mjs, voir IOS.md) : une mise à
// jour à chaud n'est appliquée que dans une app dont la coquille a la même empreinte (js/app/live-update.js,
// même principe que le runtimeVersion d'Expo). Elle doit donc changer avec tout ce qui change le binaire,
// et SEULEMENT avec ça : une empreinte qui bouge sans nouvelle build gèle les mises à jour à chaud.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const PBXPROJ = 'ios/App/App.xcodeproj/project.pbxproj';
export const RUNTIME_INPUTS = ['capacitor.config.json', 'ios/App/App/Info.plist', 'ios/App/App/App.entitlements',
  PBXPROJ, 'ios/App/RestActivity/Info.plist', 'ios/App/RestActivity/RestActivity.entitlements',
  // App Apple Watch (cible MDLFWatch) : pas de droits à elle ; son Info.plist et son icône sont dans le binaire
  'ios/App/Watch/Info.plist', 'ios/App/Watch/Assets.xcassets/AppIcon.appiconset/AppIcon.png'];
// Dossiers du code Swift : app, partagé, Live Activity (RestActivity), et Apple Watch, widget et Siri
// (AppExtras, Watch, Widgets : docs/WATCH_WIDGETS.md)
export const SWIFT_DIRS = ['ios/App/App', 'ios/App/Shared', 'ios/App/RestActivity', 'ios/App/AppExtras', 'ios/App/Watch', 'ios/App/Widgets'];

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

export function runtimeVersion(root) {
  const h = crypto.createHash('sha256');
  for (const rel of [...RUNTIME_INPUTS, ...compiledSwift(root)]) {
    const p = path.join(root, rel);
    if (fs.existsSync(p)) h.update(rel + '\0' + fs.readFileSync(p));
  }
  // Modules natifs : versions exactes installées (package-lock)
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const natives = Object.entries(lock.packages || {})
    .filter(([k]) => /node_modules\/@(capacitor|capgo|capacitor-community)\//.test(k) && !k.includes('/cli'))
    .map(([k, v]) => `${k}@${v.version}`).sort();
  h.update(natives.join('\n'));
  return h.digest('hex').slice(0, 16);
}
