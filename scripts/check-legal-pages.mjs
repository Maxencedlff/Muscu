// Garde de publication des pages juridiques (docs/JURIDIQUE.md) : échoue si une page contient encore
// un emplacement à compléter (<span class="a-completer">, « À COMPLÉTER », « À VÉRIFIER »,
// « TO COMPLETE », « TO CHECK »). Lancé aussi avant une OTA (ota.yml) et un envoi TestFlight (ios.yml),
// suivi de check-legal-online.mjs. Lancé par le job `deploy` de .github/workflows/tests.yml AVANT la
// copie vers web-public/ : tant que Maxence n'a pas rempli SIRET, téléphones, médiateur et dates, rien
// n'est mis en ligne sur mdlf.app (règle 2.1(a) d'Apple, LCEN art. 1-1, art. L616-1 du Code de la
// consommation). Testé par tests/unit/juridique.mjs.
// Lancer : node scripts/check-legal-pages.mjs privacy.html mentions-legales.html cgu.html cgv.html
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const MARKERS = [
  /class="[^"]*\ba-completer\b[^"]*"/g,
  /À COMPLÉTER/g, /À VÉRIFIER/g, /TO COMPLETE/g, /TO CHECK/g,
];

// Emplacements restants d'une page : [{ line, text }], vide si la page peut être publiée
export function legalPlaceholders(html) {
  const out = [];
  String(html).split('\n').forEach((line, i) => {
    if (MARKERS.some(re => { re.lastIndex = 0; return re.test(line); })) out.push({ line: i + 1, text: line.trim().slice(0, 140) });
  });
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = process.argv.slice(2);
  if (!files.length) { console.error('Usage : node scripts/check-legal-pages.mjs <page.html>…'); process.exit(2); }
  let left = 0;
  for (const f of files) {
    for (const p of legalPlaceholders(fs.readFileSync(f, 'utf8'))) { left++; console.error(`${f}:${p.line} : ${p.text}`); }
  }
  if (left) {
    console.error(`\n${left} emplacement(s) à compléter : publication refusée. Remplir les pages (docs/JURIDIQUE.md), puis relancer.`);
    process.exit(1);
  }
  console.log(`Pages juridiques prêtes : ${files.join(', ')}`);
}
