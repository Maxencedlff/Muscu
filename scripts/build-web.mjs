// Prépare le contenu web embarqué dans l'app iOS (dossier dist/, lu par Capacitor).
// La PWA est publiée telle quelle par Vercel ; l'app embarque les mêmes fichiers, sans le service
// worker (les mises à jour de l'app passent par l'App Store).
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
const NATIVE_TAG = '<script src="js/platform/native.js"></script>';
let index = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
if (!index.includes(NATIVE_TAG)) throw new Error('index.html ne charge plus js/platform/native.js');
index = index.replace(NATIVE_TAG, '<script src="js/vendor/capacitor.js"></script>\n  ' + NATIVE_TAG);
fs.writeFileSync(path.join(OUT, 'index.html'), index);

// Chaque script chargé par index.html doit être présent dans dist/
const html = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
const refs = [...html.matchAll(/(?:src|href)="([^"#:]+\.(?:js|css))"/g)].map(m => m[1]);
const missing = refs.filter(r => !fs.existsSync(path.join(OUT, r)));
if (missing.length) throw new Error(`Références absentes de dist/ : ${missing.join(', ')}`);
console.log(`dist/ prêt : ${refs.length} scripts et feuilles de style`);
