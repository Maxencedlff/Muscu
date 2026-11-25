// Prépare l'appli web du coach pour un déploiement (dossier dist-coach/, docs/COACH_WEB.md, « Déploiement »).
// `node scripts/build-coach-web.mjs` : copie coach-web/ et EXACTEMENT les scripts partagés que charge
// coach-web/index.html (aucun autre fichier de l'app), ramène leurs chemins ../js/ à js/, ajoute supabase-js (UMD de la
// version figée dans package.json, servi par le site : la CSP n'autorise aucun CDN) et les en-têtes.
// En-têtes : coach-web/vercel.json est la seule source. Par défaut, ils sont traduits en _headers pour Cloudflare
// Pages (hébergement de coach.mdlf.app, docs/HEBERGEMENT.md) ; avec --vercel, vercel.json est copié tel quel pour
// le projet Vercel mdlf-coach, gardé en secours. Rien n'est publié ici (job coach-web-deploy de tests.yml).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writePagesFiles } from './pages-headers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'coach-web');
const OUT = path.join(ROOT, 'dist-coach');

fs.rmSync(OUT, { recursive: true, force: true });
for (const entry of ['css', 'js']) fs.cpSync(path.join(SRC, entry), path.join(OUT, entry), { recursive: true });
// 404.html : sans elle, Pages répondrait index.html en 200 à toute adresse inconnue (Vercel répond 404)
fs.copyFileSync(path.join(SRC, '404.html'), path.join(OUT, '404.html'));
const VERCEL = process.argv.includes('--vercel');
if (VERCEL) fs.copyFileSync(path.join(SRC, 'vercel.json'), path.join(OUT, 'vercel.json'));
else writePagesFiles(path.join(SRC, 'vercel.json'), OUT);

let html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
const shared = [...html.matchAll(/<script src="\.\.\/(js\/[^"]+)"><\/script>/g)].map(m => m[1]);
if (shared.length < 30) throw new Error('coach-web/index.html : scripts partagés introuvables');
for (const f of shared) {
  const src = path.join(ROOT, f);
  if (!fs.existsSync(src)) throw new Error(`Script partagé absent : ${f}`);
  fs.mkdirSync(path.dirname(path.join(OUT, f)), { recursive: true });
  fs.copyFileSync(src, path.join(OUT, f));
}
html = html.replaceAll('src="../js/', 'src="js/');
const SUPABASE = path.join(ROOT, 'node_modules', '@supabase', 'supabase-js', 'dist', 'umd', 'supabase.js');
if (!fs.existsSync(SUPABASE)) throw new Error('@supabase/supabase-js absent : lancer npm ci');
fs.mkdirSync(path.join(OUT, 'js', 'vendor'), { recursive: true });
fs.copyFileSync(SUPABASE, path.join(OUT, 'js', 'vendor', 'supabase.js'));
const ENV_TAG = '<script src="js/desk/env.js"></script>';
if (!html.includes(ENV_TAG)) throw new Error('coach-web/index.html : env.js introuvable');
html = html.replace(ENV_TAG, `<script src="js/vendor/supabase.js"></script>\n  ${ENV_TAG}`);
fs.writeFileSync(path.join(OUT, 'index.html'), html);
console.log(`dist-coach/ prêt : ${shared.length} scripts partagés, supabase-js, en-têtes ${VERCEL ? 'Vercel' : 'Pages (_headers)'}`);
