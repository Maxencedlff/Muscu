// ═══════════════════════════════════════════════════════════
//  Chiffres du moteur d'import sur les cas RÉELS (tests/fixtures/plans/reels/, README.md) : texte lu par Apple Vision
//  ou dicté sur un iPhone, récupéré depuis l'app (« Modifier le texte »), comparé à la vérité attendue.
//  node tools/plan-corpus/reels.mjs            tableau par dossier
//  node tools/plan-corpus/reels.mjs --erreurs  plus le détail des lignes fausses
//  node tools/plan-corpus/reels.mjs --json     résultat complet en JSON
//  Même moteur et même score par ligne que mesure.mjs (planEngine, scorePlan).
// ═══════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scorePlan } from '../../tests/unit/plan-corpus-lib.mjs';
import { planEngine } from './mesure.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const REELS_DIR = path.join(ROOT, 'tests', 'fixtures', 'plans', 'reels');
export const REELS_KINDS = ['photos', 'dictees'];

// Cas d'un dossier : NN-slug.json (vérité) + NN-slug.txt (texte lu) ; un .json sans .txt est une erreur signalée
export function loadReels(dir = REELS_DIR) {
  const cases = [], problems = [];
  for (const kind of REELS_KINDS) {
    const d = path.join(dir, kind);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d).filter(x => /^\d{2,3}-.*\.json$/.test(x)).sort()) {
      const base = f.replace(/\.json$/, '');
      const txt = path.join(d, `${base}.txt`);
      if (!fs.existsSync(txt)) { problems.push(`${kind}/${base} : ${base}.txt manquant`); continue; }
      const plan = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'));
      if (!plan?.expected?.sessions) { problems.push(`${kind}/${f} : pas de expected.sessions`); continue; }
      cases.push({ kind, id: plan.id || base, plan, text: fs.readFileSync(txt, 'utf8') });
    }
  }
  return { cases, problems };
}

export function measureReels(cases, ctx = planEngine()) {
  const by = {}, details = [];
  for (const c of cases) {
    const s = scorePlan(c.plan, ctx.planParse(c.text));
    const b = (by[c.kind] ||= { plans: 0, lines: 0, ok: 0, exOk: 0, prOk: 0, extra: 0 });
    b.plans++; b.lines += s.lines; b.ok += s.ok; b.exOk += s.exOk; b.prOk += s.prOk; b.extra += s.extra;
    details.push({ id: c.id, kind: c.kind, ...s });
  }
  for (const b of Object.values(by)) {
    b.lineRate = b.ok / Math.max(1, b.lines + b.extra);
    b.exRate = b.exOk / Math.max(1, b.lines);
    b.prRate = b.prOk / Math.max(1, b.lines);
  }
  return { by, details };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { cases, problems } = loadReels();
  problems.forEach(p => console.error(`Attention : ${p}`));
  if (!cases.length) {
    console.log('Aucun cas réel pour l\'instant (tests/fixtures/plans/reels/README.md explique comment en ajouter).');
    process.exit(problems.length ? 1 : 0);
  }
  const r = measureReels(cases);
  if (process.argv.includes('--json')) { console.log(JSON.stringify(r, null, 1)); process.exit(0); }
  const pct = v => `${(v * 100).toFixed(1).replace('.', ',')} %`;
  console.log(`Cas réels : ${cases.length} (texte lu par Vision ou dicté sur un iPhone)\n`);
  console.log('Dossier   Cas  Lignes  Justes   Exercice  Prescription  En trop');
  for (const k of REELS_KINDS.filter(k => r.by[k])) {
    const b = r.by[k];
    console.log(`${k.padEnd(8)} ${String(b.plans).padStart(4)}  ${String(b.lines).padStart(6)}  ${pct(b.lineRate).padStart(7)}  ${pct(b.exRate).padStart(8)}  ${pct(b.prRate).padStart(12)}  ${String(b.extra).padStart(7)}`);
  }
  if (process.argv.includes('--erreurs')) {
    for (const d of r.details.filter(x => x.errors.length)) {
      console.log(`\n${d.kind}/${d.id} ${d.ok}/${d.lines}${d.extra ? `, ${d.extra} en trop` : ''}`);
      d.errors.forEach(e => console.log(`  ${String(e.line).slice(0, 60).padEnd(60)}  ${e.why.join(' ; ')}`));
    }
  }
  process.exit(problems.length ? 1 : 0);
}
