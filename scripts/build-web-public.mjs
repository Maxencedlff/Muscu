// Prépare le site public mdlf.app pour Cloudflare Pages (dossier dist-web/, docs/HEBERGEMENT.md).
// `node scripts/build-web-public.mjs` : web-public/ (sans README.md ni vercel.json, que Vercel ne servait pas),
// plus les pages juridiques de la racine, plus _headers et _redirects traduits de web-public/vercel.json (seule
// source des en-têtes, gardée pour le projet Vercel « muscu » de secours). Rien n'est publié ici (job deploy de tests.yml).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writePagesFiles } from './pages-headers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'web-public');
const OUT = path.join(ROOT, 'dist-web');
// Pages juridiques : écrites à la racine (l'app les lit aussi), publiées sur le site (docs/JURIDIQUE.md)
export const LEGAL = ['privacy.html', 'mentions-legales.html', 'cgu.html', 'cgv.html', 'legal.css'];
const NOT_SERVED = new Set(['README.md', 'vercel.json']);

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT);
for (const f of fs.readdirSync(SRC)) {
  if (NOT_SERVED.has(f) || f.startsWith('.')) continue;
  fs.cpSync(path.join(SRC, f), path.join(OUT, f), { recursive: true });
}
for (const f of LEGAL) fs.copyFileSync(path.join(ROOT, f), path.join(OUT, f));
writePagesFiles(path.join(SRC, 'vercel.json'), OUT);
console.log(`dist-web/ prêt : ${fs.readdirSync(OUT).length} fichiers, en-têtes Pages (_headers, _redirects)`);
