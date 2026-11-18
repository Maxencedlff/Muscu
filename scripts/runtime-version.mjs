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
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const PBXPROJ = 'ios/App/App.xcodeproj/project.pbxproj';
// Fichiers de la coquille iOS qui entrent dans l'empreinte
export const RUNTIME_INPUTS = ['capacitor.config.json', 'ios/App/App/Info.plist', 'ios/App/App/App.entitlements',
  PBXPROJ, 'ios/App/RestActivity/Info.plist', 'ios/App/RestActivity/RestActivity.entitlements',
  // App Apple Watch (cible MDLFWatch) : pas de droits à elle ; son Info.plist et son icône sont dans le binaire
  'ios/App/Watch/Info.plist', 'ios/App/Watch/Assets.xcassets/AppIcon.appiconset/AppIcon.png'];
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

// Lecture des fichiers de la coquille : dans le dossier (fsSource) ou dans un commit (gitSource, pour
// runtimeSince). Les deux rendent la même empreinte pour le même contenu.
//   read(rel)    : contenu (Buffer) ou null si absent
//   entries(dir) : [{ name, dir }] des enfants directs, ou null si le dossier n'existe pas
function fsSource(root) {
  return {
    read: rel => { try { return fs.readFileSync(path.join(root, rel)); } catch { return null; } },
    entries: dir => {
      const abs = path.join(root, dir);
      if (!fs.existsSync(abs)) return null;
      return fs.readdirSync(abs, { withFileTypes: true }).map(e => ({ name: e.name, dir: e.isDirectory() }));
    },
  };
}

// Deux appels git par commit : la liste des fichiers suivis (ls-tree), puis leur contenu en un lot
// (cat-file --batch). key : empreinte des objets lus, pour ne pas recalculer un état déjà vu.
function gitSource(root, rev, paths) {
  const git = (args, input) => execFileSync('git', args, { cwd: root, input, stdio: ['pipe', 'pipe', 'ignore'], maxBuffer: 256 << 20 });
  const tree = git(['ls-tree', '-r', '-z', rev, '--', ...paths]).toString('utf8').split('\0').filter(Boolean)
    .map(l => { const [meta, file] = l.split('\t'); const [, type, sha] = meta.split(' '); return { file, type, sha }; })
    .filter(e => e.type === 'blob');
  const out = tree.length ? git(['cat-file', '--batch'], tree.map(e => e.sha).join('\n') + '\n') : Buffer.alloc(0);
  const blobs = new Map();
  let i = 0;
  for (const e of tree) {
    const nl = out.indexOf(0x0a, i);
    const size = Number(out.subarray(i, nl).toString('utf8').split(' ')[2]);
    blobs.set(e.file, out.subarray(nl + 1, nl + 1 + size));
    i = nl + 1 + size + 1;
  }
  const files = tree.map(e => e.file);
  return {
    key: tree.map(e => `${e.file}:${e.sha}`).join('\n'),
    read: rel => blobs.get(rel) ?? null,
    entries: dir => {
      const prefix = dir + '/';
      const kids = new Map();
      for (const f of files) {
        if (!f.startsWith(prefix)) continue;
        const rest = f.slice(prefix.length);
        const j = rest.indexOf('/');
        kids.set(j < 0 ? rest : rest.slice(0, j), j >= 0);
      }
      return kids.size ? [...kids].map(([name, isDir]) => ({ name, dir: isDir })) : null;
    },
  };
}

// Un fichier Swift ne compte que s'il est compilé, c'est-à-dire référencé dans une phase « Sources » du
// projet Xcode (« Nom.swift in Sources »). Du Swift écrit mais pas encore ajouté au projet (code natif
// préparé sur une branche avant la build) ne change donc pas l'empreinte ; l'ajouter au projet modifie
// project.pbxproj, qui est lui-même dans l'empreinte. Sans projet lisible : tout le Swift compte.
function compiledSwift(src) {
  const pbx = src.read(PBXPROJ)?.toString('utf8') ?? null;
  return SWIFT_DIRS.flatMap(d => (src.entries(d) || []).filter(e => !e.dir && e.name.endsWith('.swift'))
    .map(e => e.name).sort()
    .filter(f => pbx === null || pbx.includes(`${f} in Sources`))
    .map(f => `${d}/${f}`));
}

// Tous les fichiers d'un dossier, sous-dossiers compris, dans un ordre stable
function allFiles(src, dir) {
  return (src.entries(dir) || [])
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .flatMap(e => (e.dir ? allFiles(src, `${dir}/${e.name}`) : [`${dir}/${e.name}`]));
}

const PLATFORMS = {
  ios: {
    inputs: src => [...RUNTIME_INPUTS, ...compiledSwift(src)],
    watched: [...RUNTIME_INPUTS, ...SWIFT_DIRS],
    otherShell: '@capacitor/android',
    prefix: '',
  },
  android: {
    inputs: src => [...ANDROID_INPUTS,
      ...ANDROID_DIRS.flatMap(d => allFiles(src, d)).filter(rel => !ANDROID_GENERATED.includes(rel))],
    watched: [...ANDROID_INPUTS, ...ANDROID_DIRS],
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

function runtimeOf(src, platform) {
  const spec = PLATFORMS[platform];
  if (!spec) throw new Error(`Plateforme inconnue : ${platform}`);
  const h = crypto.createHash('sha256');
  for (const rel of spec.inputs(src)) {
    const data = src.read(rel);
    if (data !== null) h.update(rel + '\0' + data);
  }
  const lock = src.read('package-lock.json');
  h.update(nativeModules(lock ? JSON.parse(lock.toString('utf8')) : {}, platform).join('\n'));
  return spec.prefix + h.digest('hex').slice(0, 16);
}

export function runtimeVersion(root, platform = 'ios') {
  return runtimeOf(fsSource(root), platform);
}

// Date (secondes, comme seq) où la coquille du commit en place est apparue : celle du dernier commit
// qui a changé son empreinte. Sert à dire, quand l'empreinte d'une mise à jour à chaud diffère de celle
// de l'app (js/app/live-update.js), laquelle des deux coquilles est la plus récente. seq (date du
// commit du contenu) ne le dit pas : une build faite depuis une branche peut avoir un contenu plus
// ancien qu'une mise à jour publiée ensuite depuis main pour l'ancienne coquille (build 91, 17/11/2026).
// null si l'historique manque (clone superficiel : fetch-depth 0 dans ios.yml et ota.yml) ou si git échoue.
export function runtimeSince(root, platform = 'ios', { maxCommits = 300 } = {}) {
  const spec = PLATFORMS[platform];
  if (!spec) throw new Error(`Plateforme inconnue : ${platform}`);
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    if (git(['rev-parse', '--is-shallow-repository']) === 'true') return null;
    const paths = [...spec.watched, 'package-lock.json'];
    const byKey = new Map();
    const at = rev => {
      let src;
      try { src = gitSource(root, rev, paths); } catch { return null; }   // pas de parent (premier commit)
      if (!byKey.has(src.key)) byKey.set(src.key, runtimeOf(src, platform));
      return byKey.get(src.key);
    };
    const head = at('HEAD');
    const log = git(['log', `--max-count=${maxCommits}`, '--format=%H %ct', 'HEAD', '--', ...paths])
      .split('\n').filter(Boolean);
    // Fusion de deux branches qui changent chacune la coquille : son empreinte ne ressemble à aucun parent,
    // runtimeSince rend la date de la fusion. C'est accepté : la coquille fusionnée est bien nouvelle, et
    // une build faite avant la fusion vient de l'une des branches (empreinte différente, date plus ancienne).
    for (const line of log) {
      const [sha, ct] = line.split(' ');
      if (at(sha) === head && at(`${sha}^`) !== head) return Number(ct);
    }
    return null;
  } catch { return null; }
}
