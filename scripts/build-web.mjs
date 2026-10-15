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

// Chaque script chargé par index.html doit être présent dans dist/
const html = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
const refs = [...html.matchAll(/(?:src|href)="([^"#:]+\.(?:js|css))"/g)].map(m => m[1]);
const missing = refs.filter(r => !fs.existsSync(path.join(OUT, r)));
if (missing.length) throw new Error(`Références absentes de dist/ : ${missing.join(', ')}`);
console.log(`dist/ prêt : ${refs.length} scripts et feuilles de style`);
