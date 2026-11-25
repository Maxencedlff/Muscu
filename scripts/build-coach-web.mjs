// Prépare l'appli web du coach pour un déploiement (dossier dist-coach/, docs/COACH_WEB.md, « Déploiement »).
// `node scripts/build-coach-web.mjs` : copie coach-web/ et EXACTEMENT les scripts partagés que charge
// coach-web/index.html (aucun autre fichier de l'app) et la base Ciqual des plans diète (data/foods.json), ramène leurs chemins ../js/ à js/, ajoute supabase-js (UMD de la
// version figée dans package.json, servi par le site : la CSP n'autorise aucun CDN) et les en-têtes.
// En-têtes : coach-web/vercel.json est la seule source. Par défaut, ils sont traduits en _headers pour Cloudflare
// Pages (hébergement de coach.mdlf.app, docs/HEBERGEMENT.md) ; avec --vercel, vercel.json est copié tel quel pour
// le projet Vercel mdlf-coach, gardé en secours. Rien n'est publié ici (job coach-web-deploy de tests.yml).
// buildCoachWeb(out, { headers }) sert aussi à l'app : scripts/embed-coach-web.mjs embarque la même sortie, sans
// en-têtes (headers: 'none'), dans dist/coach/ (mode coach grand écran sur iPad, docs/COACH_IPAD.md).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writePagesFiles } from './pages-headers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'coach-web');
const OUT = path.join(ROOT, 'dist-coach');

// Construit l'appli web du coach dans `out` ; headers : 'pages' (_headers), 'vercel' (vercel.json) ou 'none'.
// Rend le nombre de scripts partagés copiés
export function buildCoachWeb(out = OUT, { headers = 'pages' } = {}) {
  fs.rmSync(out, { recursive: true, force: true });
  for (const entry of ['css', 'js']) fs.cpSync(path.join(SRC, entry), path.join(out, entry), { recursive: true });
  // 404.html : sans elle, Pages répondrait index.html en 200 à toute adresse inconnue (Vercel répond 404)
  if (headers !== 'none') fs.copyFileSync(path.join(SRC, '404.html'), path.join(out, '404.html'));
  if (headers === 'vercel') fs.copyFileSync(path.join(SRC, 'vercel.json'), path.join(out, 'vercel.json'));
  else if (headers === 'pages') writePagesFiles(path.join(SRC, 'vercel.json'), out);

  let html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
  const shared = [...html.matchAll(/<script src="\.\.\/(js\/[^"]+)"><\/script>/g)].map(m => m[1]);
  if (shared.length < 30) throw new Error('coach-web/index.html : scripts partagés introuvables');
  for (const f of shared) {
    const src = path.join(ROOT, f);
    if (!fs.existsSync(src)) throw new Error(`Script partagé absent : ${f}`);
    fs.mkdirSync(path.dirname(path.join(out, f)), { recursive: true });
    fs.copyFileSync(src, path.join(out, f));
  }
  html = html.replaceAll('src="../js/', 'src="js/');
  // Base Ciqual des plans diète (data/foods.json, chargée à la demande) : servie à côté de la page, sur le site comme
  // dans la copie embarquée de l'app (dist/coach/ : même chemin relatif)
  const FOODS_META = '<meta name="mdlf-foods" content="../data/foods.json">';
  if (!html.includes(FOODS_META)) throw new Error('coach-web/index.html : balise mdlf-foods introuvable');
  html = html.replace(FOODS_META, '<meta name="mdlf-foods" content="data/foods.json">');
  fs.mkdirSync(path.join(out, 'data'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'data', 'foods.json'), path.join(out, 'data', 'foods.json'));
  const SUPABASE = path.join(ROOT, 'node_modules', '@supabase', 'supabase-js', 'dist', 'umd', 'supabase.js');
  if (!fs.existsSync(SUPABASE)) throw new Error('@supabase/supabase-js absent : lancer npm ci');
  fs.mkdirSync(path.join(out, 'js', 'vendor'), { recursive: true });
  fs.copyFileSync(SUPABASE, path.join(out, 'js', 'vendor', 'supabase.js'));
  const ENV_TAG = '<script src="js/desk/env.js"></script>';
  if (!html.includes(ENV_TAG)) throw new Error('coach-web/index.html : env.js introuvable');
  html = html.replace(ENV_TAG, `<script src="js/vendor/supabase.js"></script>\n  ${ENV_TAG}`);
  fs.writeFileSync(path.join(out, 'index.html'), html);
  return shared.length;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const VERCEL = process.argv.includes('--vercel');
  const n = buildCoachWeb(OUT, { headers: VERCEL ? 'vercel' : 'pages' });
  console.log(`dist-coach/ prêt : ${n} scripts partagés, base Ciqual, supabase-js, en-têtes ${VERCEL ? 'Vercel' : 'Pages (_headers)'}`);
}
