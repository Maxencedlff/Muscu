// ═══════════════════════════════════════════════════════════
//  Copie de la bibliothèque d'exercices pour la fonction serveur plan-import-ai (docs/IMPORT_IA.md) : noms et
//  alias de js/data/exercise-catalogue.js, rien d'autre (ni muscles ni matériel). Le serveur n'accepte que ces noms ;
//  la liste est aussi la partie stable (mise en cache) de la consigne envoyée au modèle.
//
//  node tools/plan-import-ia/bibliotheque.mjs           réécrit supabase/functions/plan-import-ai/library.js
//  node tools/plan-import-ia/bibliotheque.mjs --check   code 1 si le fichier n'est plus à jour (tests unitaires)
// ═══════════════════════════════════════════════════════════
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { planEngine } from '../plan-corpus/mesure.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const LIBRARY_FILE = path.join(ROOT, 'supabase', 'functions', 'plan-import-ai', 'library.js');

export function librarySource() {
  const ctx = planEngine();
  const list = JSON.parse(JSON.stringify(vm.runInContext('EXERCISE_CATALOGUE', ctx) ?? [])).map(e => [e.name, (e.aliases || []).filter(a => typeof a === 'string' && a.length <= 60)]);
  if (!list.length) throw new Error('bibliothèque vide');
  const body = JSON.stringify(list);
  const version = crypto.createHash('sha256').update(body).digest('hex').slice(0, 16);
  return `// FICHIER GÉNÉRÉ par tools/plan-import-ia/bibliotheque.mjs depuis js/data/exercise-catalogue.js : ne pas modifier à la main.
// [nom, alias] de chaque exercice de la bibliothèque de l'app ; LIBRARY_VERSION change avec la liste (clés du cache).
export const LIBRARY_VERSION = '${version}';
/** @type {Array<[string, string[]]>} */
export const LIBRARY = ${JSON.stringify(list, null, 0).replace(/\],\[/g, '],\n  [').replace(/^\[\[/, '[\n  [').replace(/\]\]$/, ']\n]')};
`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const src = librarySource();
  if (process.argv.includes('--check')) {
    const cur = fs.existsSync(LIBRARY_FILE) ? fs.readFileSync(LIBRARY_FILE, 'utf8') : '';
    if (cur !== src) { console.error('library.js n\'est plus à jour : node tools/plan-import-ia/bibliotheque.mjs'); process.exit(1); }
    console.log('library.js à jour');
  } else {
    fs.writeFileSync(LIBRARY_FILE, src);
    console.log(`écrit ${path.relative(ROOT, LIBRARY_FILE)}`);
  }
}
