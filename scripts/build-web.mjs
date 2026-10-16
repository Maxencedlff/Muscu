// Prépare le contenu web embarqué dans l'app iOS (dossier dist/, lu par Capacitor).
// La PWA est publiée telle quelle par Vercel ; l'app embarque les mêmes fichiers, sans le service
// worker (les mises à jour de l'app passent par l'App Store).
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT  = path.join(ROOT, 'dist');
const ENTRIES = ['index.html', 'manifest.json', 'privacy.html', 'icon.svg', 'apple-touch-icon.png',
                 'icon-192.png', 'icon-512.png', 'css', 'js'];

fs.rmSync(OUT, { recursive: true, force: true });
for (const entry of ENTRIES) {
  const src = path.join(ROOT, entry);
  if (!fs.existsSync(src)) throw new Error(`Fichier manquant pour l'app : ${entry}`);
  fs.cpSync(src, path.join(OUT, entry), { recursive: true });
}

// Runtime JavaScript de Capacitor (registerPlugin…) : la coquille iOS n'injecte que le canal natif.
// Embarqué seulement dans l'app, chargé avant le pont natif (js/platform/native.js).
const CORE = path.join(ROOT, 'node_modules', '@capacitor', 'core', 'dist', 'capacitor.js');
if (!fs.existsSync(CORE)) throw new Error('@capacitor/core absent : lancer npm ci');
fs.mkdirSync(path.join(OUT, 'js', 'vendor'), { recursive: true });
fs.copyFileSync(CORE, path.join(OUT, 'js', 'vendor', 'capacitor.js'));
// Informations de construction (mises à jour à chaud, voir IOS.md) :
// - runtime : empreinte de tout ce qui est natif. Une mise à jour web n'est appliquée que dans une app
//   dont la coquille a la même empreinte (même principe que le runtimeVersion d'Expo).
// - seq : date du commit (secondes) ; une mise à jour plus ancienne que le contenu en place est ignorée.
// - version : identifiant lisible du contenu (date du commit + commit court).
const RUNTIME_INPUTS = ['capacitor.config.json', 'ios/App/App/Info.plist', 'ios/App/App/App.entitlements',
  'ios/App/App.xcodeproj/project.pbxproj'];
function runtimeVersion() {
  const h = crypto.createHash('sha256');
  const swift = fs.readdirSync(path.join(ROOT, 'ios/App/App')).filter(f => f.endsWith('.swift')).sort()
    .map(f => 'ios/App/App/' + f);
  for (const rel of [...RUNTIME_INPUTS, ...swift]) {
    const p = path.join(ROOT, rel);
    if (fs.existsSync(p)) h.update(rel + '\0' + fs.readFileSync(p));
  }
  // Modules natifs : versions exactes installées (package-lock)
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  const natives = Object.entries(lock.packages || {})
    .filter(([k]) => /node_modules\/@(capacitor|capgo|capacitor-community)\//.test(k) && !k.includes('/cli'))
    .map(([k, v]) => `${k}@${v.version}`).sort();
  h.update(natives.join('\n'));
  return h.digest('hex').slice(0, 16);
}
function gitInfo() {
  try {
    const [sha, ct] = execSync('git log -1 --format=%h%n%ct', { cwd: ROOT }).toString().trim().split('\n');
    const dirty = execSync('git status --porcelain -- js css index.html', { cwd: ROOT }).toString().trim() !== '';
    return { sha: sha + (dirty ? '-local' : ''), seq: Number(ct) };
  } catch { return { sha: 'local', seq: Math.floor(Date.now() / 1000) }; }
}
const git  = gitInfo();
const d    = new Date(git.seq * 1000);
const BUILD = {
  runtime: runtimeVersion(),
  seq: git.seq,
  version: `${d.getUTCFullYear()}.${d.getUTCMonth() + 1}.${d.getUTCDate()}-${git.sha}`,
};
fs.writeFileSync(path.join(OUT, 'js', 'platform', 'build-info.js'),
  `'use strict';\n// Généré par scripts/build-web.mjs : ne pas modifier\nwindow.MDLF_BUILD = ${JSON.stringify(BUILD)};\n`);
fs.writeFileSync(path.join(OUT, 'build-info.json'), JSON.stringify(BUILD, null, 2) + '\n');

const NATIVE_TAG = '<script src="js/platform/native.js"></script>';
let index = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
if (!index.includes(NATIVE_TAG)) throw new Error('index.html ne charge plus js/platform/native.js');
index = index.replace(NATIVE_TAG, '<script src="js/vendor/capacitor.js"></script>\n  <script src="js/platform/build-info.js"></script>\n  ' + NATIVE_TAG);
fs.writeFileSync(path.join(OUT, 'index.html'), index);

// Chaque script chargé par index.html doit être présent dans dist/
const html = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
const refs = [...html.matchAll(/(?:src|href)="([^"#:]+\.(?:js|css))"/g)].map(m => m[1]);
const missing = refs.filter(r => !fs.existsSync(path.join(OUT, r)));
if (missing.length) throw new Error(`Références absentes de dist/ : ${missing.join(', ')}`);
console.log(`dist/ prêt : ${refs.length} scripts et feuilles de style · contenu ${BUILD.version} · runtime ${BUILD.runtime}`);
