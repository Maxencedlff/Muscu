// Prépare le contenu web embarqué dans l'app (dossier dist/, lu par Capacitor).
// La PWA est publiée telle quelle par Vercel ; l'app embarque les mêmes fichiers, sans le service
// worker (les mises à jour de l'app passent par l'App Store ou Google Play).
// `node scripts/build-web.mjs` : app iOS ; `--android` : app Android (seule l'empreinte native change).
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runtimeVersion } from './runtime.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT  = path.join(ROOT, 'dist');
const ENTRIES = ['index.html', 'manifest.json', 'privacy.html', 'legal.css', 'icon.svg', 'apple-touch-icon.png',
                 'icon-192.png', 'icon-512.png', 'css', 'js', 'img'];

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
// supabase-js (compte MDLF, js/data/account.js) : fichier UMD de la version figée dans package.json,
// embarqué (l'app marche hors ligne, aucun script chargé depuis un CDN)
const SUPABASE = path.join(ROOT, 'node_modules', '@supabase', 'supabase-js', 'dist', 'umd', 'supabase.js');
if (!fs.existsSync(SUPABASE)) throw new Error('@supabase/supabase-js absent : lancer npm ci');
fs.copyFileSync(SUPABASE, path.join(OUT, 'js', 'vendor', 'supabase.js'));
// Informations de construction (mises à jour à chaud, voir IOS.md) :
// - runtime : empreinte de tout ce qui est natif, propre à chaque plateforme (scripts/runtime.mjs). Une
//   mise à jour web n'est appliquée que dans une app dont la coquille a la même empreinte (même principe
//   que le runtimeVersion d'Expo).
// - seq : date du commit (secondes) ; une mise à jour plus ancienne que le contenu en place est ignorée.
// - version : identifiant lisible du contenu (date du commit + commit court).
const PLATFORM = process.argv.includes('--android') ? 'android' : 'ios';
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
  runtime: runtimeVersion(ROOT, PLATFORM),
  seq: git.seq,
  version: `${d.getUTCFullYear()}.${d.getUTCMonth() + 1}.${d.getUTCDate()}-${git.sha}`,
};
fs.writeFileSync(path.join(OUT, 'js', 'platform', 'build-info.js'),
  `'use strict';\n// Généré par scripts/build-web.mjs : ne pas modifier\nwindow.MDLF_BUILD = ${JSON.stringify(BUILD)};\n`);
fs.writeFileSync(path.join(OUT, 'build-info.json'), JSON.stringify(BUILD, null, 2) + '\n');

const NATIVE_TAG = '<script src="js/platform/native.js"></script>';
let index = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
if (!index.includes(NATIVE_TAG)) throw new Error('index.html ne charge plus js/platform/native.js');
index = index.replace(NATIVE_TAG, '<script src="js/vendor/capacitor.js"></script>\n  <script src="js/vendor/supabase.js"></script>\n  <script src="js/platform/build-info.js"></script>\n  ' + NATIVE_TAG);
fs.writeFileSync(path.join(OUT, 'index.html'), index);

// Chaque script chargé par index.html doit être présent dans dist/
const html = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
const refs = [...html.matchAll(/(?:src|href)="([^"#:]+\.(?:js|css))"/g)].map(m => m[1]);
const missing = refs.filter(r => !fs.existsSync(path.join(OUT, r)));
if (missing.length) throw new Error(`Références absentes de dist/ : ${missing.join(', ')}`);
console.log(`dist/ prêt (${PLATFORM}) : ${refs.length} scripts et feuilles de style · contenu ${BUILD.version} · runtime ${BUILD.runtime}`);
