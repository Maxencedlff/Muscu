// Traduit un vercel.json en fichiers _headers et _redirects de Cloudflare Pages (docs/HEBERGEMENT.md).
//   node scripts/pages-headers.mjs <vercel.json> <dossier publié>
// Le vercel.json reste la seule source des en-têtes : Vercel (filet de secours) et Pages servent donc les mêmes.
// Ne traduit que ce que nos sites utilisent ; tout le reste (rewrites, motifs autres que « /chemin » ou
// « /dossier/(.*) », en-tête posé par deux règles qui se recouvrent) arrête la construction au lieu d'être deviné.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Clés de vercel.json sans effet sur un site statique hébergé ailleurs (git : publication automatique de Vercel ;
// crons : réveil du serveur des comptes, qui reste chez Vercel, docs/HEBERGEMENT.md)
const IGNORED = new Set(['git', 'crons', '$schema']);
// cleanUrls : Pages sert déjà /page pour page.html et redirige /page.html vers /page en 308 (comportement fixe,
// identique à cleanUrls: true de Vercel). Sans cleanUrls, Vercel sert /page.html tel quel : pour garder ces
// adresses (privacy.html déclarée à l'App Store, liens de l'app), chaque page reçoit une réécriture
// « /page.html /page 200 » (htmlRewrites), vérifiée sur Pages le 25/11/2026.
const NATIVE = new Set(['cleanUrls']);

/** "/(.*)" → "/*", "/js/(.*)" → "/js/*", "/sw.js" → "/sw.js" ; autre motif : erreur. */
export function pagesPattern(source) {
  if (source === '/(.*)') return '/*';
  const dir = source.match(/^(\/[\w.-]+(?:\/[\w.-]+)*)\/\(\.\*\)$/);
  if (dir) return `${dir[1]}/*`;
  if (/^\/[\w.-]+(?:\/[\w.-]+)*$/.test(source)) return source;
  throw new Error(`Motif Vercel non traduit : ${source}`);
}

function covers(general, specific) {
  if (general === specific) return true;
  return general.endsWith('/*') && specific.startsWith(general.slice(0, -1));
}

/** Réécritures qui gardent /page.html en 200 sur Pages (htmlFiles : chemins relatifs, « / » comme séparateur). */
export function htmlRewrites(htmlFiles) {
  return htmlFiles.filter(f => f.endsWith('.html') && f !== '404.html').sort().map(f => {
    const pretty = f === 'index.html' ? '/' : f.endsWith('/index.html') ? `/${f.slice(0, -'index.html'.length)}` : `/${f.slice(0, -5)}`;
    return `/${f} ${pretty} 200`;
  });
}

/** { headers, redirects } : contenu des deux fichiers (redirects vide s'il n'y en a pas).
 *  htmlFiles : pages du dossier publié, pour les réécritures quand cleanUrls n'est pas activé. */
export function vercelToPages(config, htmlFiles = []) {
  for (const key of Object.keys(config)) {
    if (!IGNORED.has(key) && !NATIVE.has(key) && key !== 'headers' && key !== 'redirects') {
      throw new Error(`Clé vercel.json non traduite pour Pages : ${key}`);
    }
  }
  const rules = (config.headers || []).map(r => ({
    pattern: pagesPattern(r.source),
    headers: r.headers.map(h => {
      if (/[\r\n]/.test(h.value)) throw new Error(`Valeur sur plusieurs lignes : ${h.key}`);
      return [h.key, h.value];
    }),
  }));
  // Pages additionne les règles qui visent la même adresse et joint les valeurs d'un même en-tête par une
  // virgule : deux règles qui se recouvrent ne doivent donc jamais poser le même en-tête.
  for (const a of rules) for (const b of rules) {
    if (a === b || !(covers(a.pattern, b.pattern) || covers(b.pattern, a.pattern))) continue;
    const keys = new Set(a.headers.map(([k]) => k.toLowerCase()));
    const dup = b.headers.find(([k]) => keys.has(k.toLowerCase()));
    if (dup) throw new Error(`En-tête ${dup[0]} posé par ${a.pattern} et ${b.pattern} : Pages joindrait les deux valeurs`);
  }
  const headers = rules.map(r => [r.pattern, ...r.headers.map(([k, v]) => `  ${k}: ${v}`)].join('\n')).join('\n\n') + '\n';
  const redirects = (config.redirects || []).map(r => {
    // Adresses fixes seulement : les captures de Vercel (:chemin*) n'ont pas la même syntaxe que celles de Pages
    if (/\/:|[(*]/.test(r.source + r.destination)) throw new Error(`Redirection à motif non traduite : ${r.source}`);
    const code = r.statusCode || (r.permanent === false ? 307 : 308);
    return `${r.source} ${r.destination} ${code}`;
  });
  // Les redirections d'abord : Pages applique la première règle qui correspond
  if (!config.cleanUrls) redirects.push(...htmlRewrites(htmlFiles));
  return { headers, redirects: redirects.length ? redirects.join('\n') + '\n' : '' };
}

/** Écrit _headers (et _redirects s'il y a des redirections) dans outDir. */
export function writePagesFiles(vercelJsonPath, outDir) {
  const html = fs.readdirSync(outDir, { recursive: true }).map(f => String(f).split(path.sep).join('/'));
  const { headers, redirects } = vercelToPages(JSON.parse(fs.readFileSync(vercelJsonPath, 'utf8')), html);
  fs.writeFileSync(path.join(outDir, '_headers'), headers);
  if (redirects) fs.writeFileSync(path.join(outDir, '_redirects'), redirects);
  else fs.rmSync(path.join(outDir, '_redirects'), { force: true });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [src, out] = process.argv.slice(2);
  if (!src || !out) { console.error('Usage : node scripts/pages-headers.mjs <vercel.json> <dossier>'); process.exit(2); }
  writePagesFiles(src, out);
  console.log(`${out}/_headers écrit depuis ${src}`);
}
