// Prépare l'appli web du coach pour un déploiement (dossier dist-coach/, docs/COACH_WEB.md, « Déploiement »).
// `node scripts/build-coach-web.mjs` : copie coach-web/ et EXACTEMENT les scripts partagés que charge
// coach-web/index.html (aucun autre fichier de l'app) et la base Ciqual (data/foods.json), ramène leurs chemins ../js/ à js/, ajoute supabase-js (UMD de la
// version figée dans package.json, servi par le site : la CSP n'autorise aucun CDN) et les en-têtes Vercel.
// Rien n'est publié ici : la publication se fait à la main, après le feu vert de Maxence.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'coach-web');
const OUT = path.join(ROOT, 'dist-coach');

fs.rmSync(OUT, { recursive: true, force: true });
for (const entry of ['css', 'js']) fs.cpSync(path.join(SRC, entry), path.join(OUT, entry), { recursive: true });
fs.copyFileSync(path.join(SRC, 'vercel.json'), path.join(OUT, 'vercel.json'));

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
// Base Ciqual des plans diète (data/foods.json, chargée à la demande) : servie à côté de la page
const FOODS_META = '<meta name="mdlf-foods" content="../data/foods.json">';
if (!html.includes(FOODS_META)) throw new Error('coach-web/index.html : balise mdlf-foods introuvable');
html = html.replace(FOODS_META, '<meta name="mdlf-foods" content="data/foods.json">');
fs.mkdirSync(path.join(OUT, 'data'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'data', 'foods.json'), path.join(OUT, 'data', 'foods.json'));
const SUPABASE = path.join(ROOT, 'node_modules', '@supabase', 'supabase-js', 'dist', 'umd', 'supabase.js');
if (!fs.existsSync(SUPABASE)) throw new Error('@supabase/supabase-js absent : lancer npm ci');
fs.mkdirSync(path.join(OUT, 'js', 'vendor'), { recursive: true });
fs.copyFileSync(SUPABASE, path.join(OUT, 'js', 'vendor', 'supabase.js'));
const ENV_TAG = '<script src="js/desk/env.js"></script>';
if (!html.includes(ENV_TAG)) throw new Error('coach-web/index.html : env.js introuvable');
html = html.replace(ENV_TAG, `<script src="js/vendor/supabase.js"></script>\n  ${ENV_TAG}`);
fs.writeFileSync(path.join(OUT, 'index.html'), html);
console.log(`dist-coach/ prêt : ${shared.length} scripts partagés, base Ciqual, supabase-js, en-têtes Vercel`);
