// ═══════════════════════════════════════════════════════════
//  Chiffres du moteur d'import de programme sur le corpus (docs/IMPORT_PROGRAMME.md, « Mesure »)
//  node tools/plan-corpus/mesure.mjs            tableau par catégorie
//  node tools/plan-corpus/mesure.mjs --erreurs  plus le détail des lignes fausses
//  node tools/plan-corpus/mesure.mjs --json     résultat complet en JSON
//  Les seuils (90 % propre, 75 % libre et photo) sont vérifiés par tests/unit/plan-import.mjs.
// ═══════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { loadCorpus, measure } from '../../tests/unit/plan-corpus-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// Seuls les scripts dont le moteur a besoin, dans l'ordre de index.html
export const PLAN_ENGINE_SCRIPTS = ['js/core/util.js', 'js/data/tempo.js', 'js/data/warmup.js', 'js/data/intensif.js', 'js/data/muscles.js',
  'js/data/exercise-catalogue.js', 'js/data/import-csv.js', 'js/data/plan-grammar.js', 'js/data/plan-match.js', 'js/data/plan-table.js',
  'js/data/plan-parser.js', 'js/data/plan-aliases.js'];

export function planEngine() {
  const ctx = vm.createContext({ console, window: {}, document: { querySelector: () => null, getElementById: () => null }, navigator: {}, localStorage: { getItem: () => null, setItem() {} } });
  for (const f of PLAN_ENGINE_SCRIPTS) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  return ctx;
}
export const engineParse = ctx => input => ctx.planParse(input.boxes ? ctx.planTextFromBoxes(input.boxes) : input.text);

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const ctx = planEngine();
  const corpus = loadCorpus(ROOT);
  const r = measure(corpus, engineParse(ctx));
  if (process.argv.includes('--json')) { console.log(JSON.stringify(r, null, 1)); process.exit(0); }
  const pct = v => `${(v * 100).toFixed(1).replace('.', ',')} %`;
  console.log(`Corpus : ${corpus.length} plans, ${r.details.length} cas mesurés\n`);
  console.log('Catégorie        Plans  Lignes  Justes   Exercice  Prescription  En trop  Séances justes');
  const order = ['propre', 'tableau', 'libre', 'dictee', 'photo', 'photo-tableau'];
  let tot = { plans: 0, lines: 0, ok: 0, extra: 0, exOk: 0, prOk: 0 };
  for (const k of order.filter(k => r.by[k])) {
    const b = r.by[k];
    Object.keys(tot).forEach(x => { tot[x] += b[x]; });
    console.log(`${k.padEnd(16)} ${String(b.plans).padStart(5)}  ${String(b.lines).padStart(6)}  ${pct(b.lineRate).padStart(7)}  ${pct(b.exRate).padStart(8)}  ${pct(b.prRate).padStart(12)}  ${String(b.extra).padStart(7)}  ${b.sessionsOk}/${b.plans}`);
  }
  console.log(`${'total'.padEnd(16)} ${String(tot.plans).padStart(5)}  ${String(tot.lines).padStart(6)}  ${pct(tot.ok / (tot.lines + tot.extra)).padStart(7)}  ${pct(tot.exOk / tot.lines).padStart(8)}  ${pct(tot.prOk / tot.lines).padStart(12)}  ${String(tot.extra).padStart(7)}`);
  if (process.argv.includes('--erreurs')) {
    for (const d of r.details.filter(x => x.errors.length)) {
      console.log(`\n${d.id} [${d.kind}] ${d.ok}/${d.lines}${d.extra ? `, ${d.extra} en trop` : ''}${d.sessionsExp !== d.sessionsGot ? `, séances ${d.sessionsGot} au lieu de ${d.sessionsExp}` : ''}`);
      d.errors.forEach(e => console.log(`  ${String(e.line).slice(0, 60).padEnd(60)}  ${e.why.join(' ; ')}`));
    }
  }
}
