// ═══════════════════════════════════════════════════════════
//  Mesure du moteur d'import sur du RÉEL (tests/fixtures/plans/reels/SOURCES.md)
//  - documents réels (photos, tableaux, manuscrits, PDF) : sortie d'Apple Vision sur macOS (vision-ocr.swift)
//    → planTextFromPages → planParse, comparée à la vérité écrite à la main ;
//  - dictées : vrai son (voix françaises de macOS, `say`) transcrit par SFSpeechRecognizer (speech-transcribe.swift)
//    ou, en repli, par whisper.cpp → planParse.
//  Chaque document est aussi mesuré sur sa transcription humaine (« texte parfait ») : l'écart entre les deux
//  colonnes, c'est ce que coûte la lecture ; le reste, c'est le moteur.
//
//  node tools/plan-corpus/mesure-reel.mjs                 tableau par catégorie et 10 erreurs les plus fréquentes
//  node tools/plan-corpus/mesure-reel.mjs --erreurs       plus le détail par document
//  node tools/plan-corpus/mesure-reel.mjs --markdown      même tableau en Markdown (résumé du workflow)
//  node tools/plan-corpus/mesure-reel.mjs --json          résultat complet
//  Préparation sur la machine macOS (corpus-reel.yml) :
//    --vocabulaire DOSSIER   mots-exercice.json et mots-tout.json (planDictationWords, comme l'app)
//    --liste-ocr             une entrée par ligne pour vision-ocr (fichier, ou fichier.pdf:pages)
//    --dictees DOSSIER       un <id>.txt par script de dictée, pour `say`
//  Corpus : tests/fixtures/plans/reels/ (versionné, licences libres) + $CORPUS_LOCAL
//  (défaut ~/.local/share/mdlf/corpus-import : documents non libres, jamais dans le dépôt).
// ═══════════════════════════════════════════════════════════
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planEngine } from './mesure.mjs';
import { scorePlan } from '../../tests/unit/plan-corpus-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const REELS = path.join(ROOT, 'tests', 'fixtures', 'plans', 'reels');
const LOCAL = process.env.CORPUS_LOCAL || path.join(os.homedir(), '.local', 'share', 'mdlf', 'corpus-import');
const argv = process.argv.slice(2);
const opt = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };

const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const jsonIn = dir => (fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort().map(f => path.join(dir, f)) : []);

// ── Corpus ─────────────────────────────────────────────────
// Un document : vérité (verite/<id>.json) ; son fichier est dans reels/fichiers/ (libre) ou dans LOCAL/brut-*/ (non libre)
export function loadReal() {
  const docs = [];
  const seen = new Set();
  for (const [where, dir] of [['depot', path.join(REELS, 'verite')], ['local', path.join(LOCAL, 'verite')]]) {
    for (const f of jsonIn(dir)) {
      const d = readJson(f);
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      docs.push({ ...d, where });
    }
  }
  return docs;
}
export const loadDictations = () => jsonIn(path.join(REELS, 'dictees-scripts')).map(readJson);

// Fichier d'un document : versionné d'abord, sinon le dossier local
function docFile(d) {
  const name = d.file || d.source_id;
  for (const dir of [path.join(REELS, 'fichiers'), path.join(LOCAL, 'brut-images'), path.join(LOCAL, 'brut-pdf')]) {
    if (!fs.existsSync(dir)) continue;
    const hit = fs.readdirSync(dir).find(f => f === name || (path.parse(f).name === name && !f.endsWith('.json')));
    if (hit) return path.join(dir, hit);
  }
  return null;
}

// Sorties des outils macOS : reels/sorties (CI, versionné) puis LOCAL/sorties
function outputs() {
  const all = new Map();
  for (const dir of [path.join(REELS, 'sorties'), path.join(LOCAL, 'sorties')]) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.json'))) if (!all.has(f)) all.set(f, path.join(dir, f));
  }
  return all;
}

// ── Classement des erreurs ─────────────────────────────────
// Raisons rendues par scorePlan (« nom:A≠B », « sets:4≠undefined », « manquante »…) → famille lisible
const FIELD = { sets: 'séries', repMin: 'reps', repMax: 'reps', seconds: 'durée', rest: 'repos', amrap: 'max/échec', load: 'charge', pct: '%',
  rpe: 'RPE', rir: 'RIR', tempo: 'tempo', uni: 'par bras/jambe', tech: 'technique', techWhere: 'technique' };
export function errorFamily(why) {
  if (why === 'manquante') return 'exercice manquant (ligne non vue comme un exercice)';
  if (why === 'en trop') return 'ligne inventée (en trop)';
  if (why.startsWith('nom:')) return /≠\?/.test(why) ? 'nom pas reconnu (hors bibliothèque)' : 'mauvais exercice reconnu';
  if (why.startsWith('séance:')) return 'mauvaise séance (découpage)';
  if (why.startsWith('superset:')) return 'superset mal lu';
  const m = /^(\w+):(.*)≠(.*)$/.exec(why);
  if (!m) return why;
  const f = FIELD[m[1]] || m[1], none = v => v === 'undefined' || v === 'false';
  if (none(m[3])) return `${f} non lu(e)s`;
  if (none(m[2])) return `${f} inventé(e)s`;
  return `${f} faux`;
}

// ── Mesure ─────────────────────────────────────────────────
const pct = v => (Number.isFinite(v) ? `${(v * 100).toFixed(1).replace('.', ',')} %` : '—');

export function measureReal() {
  const ctx = planEngine();
  const outs = outputs();
  const docs = loadReal();
  const dictations = loadDictations();
  const cases = [];
  const missing = { ocr: [], stt: 0 };
  const run = (plan, kind, source, text, meta = {}) => {
    const draft = ctx.planParse(text);
    cases.push({ id: plan.id, kind, source, text, ...meta, ...scorePlan(plan, draft) });
  };
  for (const d of docs) {
    const cat = d.category;
    run(d, cat, 'texte', d.text, { where: d.where });
    const pj = outs.get(`${d.id}.pdfjs.json`);
    if (pj) run(d, cat, 'pdfjs', ctx.planTextFromBoxes(readJson(pj).boxes), { where: d.where });
    const te = outs.get(`${d.id}.tesseract.json`);
    if (te) run(d, cat, 'tesseract', ctx.planTextFromPages(readJson(te).pages), { where: d.where });
    const o = outs.get(`${d.id}.ocr.json`);
    if (!o) { missing.ocr.push(d); continue; }
    const r = readJson(o);
    run(d, cat, 'vision', ctx.planTextFromPages(r.pages), { where: d.where });
  }
  for (const d of dictations) {
    run(d, 'dictee', 'texte', d.text);
    for (const [f, p] of outs) {
      if (!f.startsWith(`${d.id}__`)) continue;
      const r = readJson(p);
      const variant = f.slice(d.id.length + 2).replace(/\.(stt|whisper)\.json$/, '');
      if (!r.text) continue;
      run(d, 'dictee', f.endsWith('.whisper.json') ? 'whisper' : 'sfspeech', r.text, { variant, onDevice: r.onDevice });
    }
  }
  if (!cases.some(c => c.source === 'sfspeech')) missing.stt = dictations.length;
  // Totaux par catégorie et par source de texte
  const by = {};
  for (const c of cases) {
    const b = (by[`${c.kind}|${c.source}`] ||= { kind: c.kind, source: c.source, docs: 0, lines: 0, ok: 0, exOk: 0, prOk: 0, extra: 0, sessionsOk: 0 });
    b.docs++; b.lines += c.lines; b.ok += c.ok; b.exOk += c.exOk; b.prOk += c.prOk; b.extra += c.extra;
    if (c.sessionsExp === c.sessionsGot) b.sessionsOk++;
  }
  for (const b of Object.values(by)) {
    b.lineRate = b.ok / Math.max(1, b.lines + b.extra);
    b.exRate = b.exOk / Math.max(1, b.lines);
    b.prRate = b.prOk / Math.max(1, b.lines);
  }
  // Erreurs les plus fréquentes, avec un exemple : sur les vraies lectures (Apple Vision, pdf.js de l'app, SFSpeech,
  // whisper ; pas Tesseract, simple approximation) et sur le texte parfait (le moteur seul)
  const topOf = list => {
    const fam = new Map();
    for (const c of list) {
      for (const e of c.errors) {
        for (const w of e.why) {
          const k = errorFamily(w);
          const f = fam.get(k) || { family: k, n: 0, ex: null, docs: new Set() };
          f.n++; f.docs.add(c.id);
          if (!f.ex || (f.ex.source !== 'vision' && c.source === 'vision')) f.ex = { id: c.id, source: c.source, line: e.line, why: e.why.join(' ; ') };
          fam.set(k, f);
        }
      }
    }
    return [...fam.values()].sort((x, y) => y.n - x.n).slice(0, 10).map(f => ({ ...f, docs: f.docs.size }));
  };
  const top = topOf(cases.filter(x => ['vision', 'pdfjs', 'sfspeech', 'whisper'].includes(x.source)));
  const topEngine = topOf(cases.filter(x => x.source === 'texte'));
  return { docs, dictations, cases, by, top, topEngine, missing };
}

// ── Préparation (machine macOS) ────────────────────────────
function prepare() {
  if (opt('--vocabulaire')) {
    const dir = opt('--vocabulaire'), ctx = planEngine();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'mots-exercice.json'), JSON.stringify(ctx.planDictationWords('exercice')));
    fs.writeFileSync(path.join(dir, 'mots-tout.json'), JSON.stringify(ctx.planDictationWords('tout')));
    return true;
  }
  if (argv.includes('--liste-ocr')) {
    // Seulement les documents versionnés : les fichiers non libres ne vont jamais sur GitHub
    for (const d of loadReal().filter(x => x.where === 'depot')) {
      const f = docFile(d);
      if (!f) { console.error(`${d.id} : fichier absent`); continue; }
      console.log(f.endsWith('.pdf') && d.pages?.length ? `${path.relative(ROOT, f)}:${d.pages.join(',')}` : path.relative(ROOT, f));
    }
    return true;
  }
  if (opt('--dictees')) {
    const dir = opt('--dictees');
    fs.mkdirSync(dir, { recursive: true });
    for (const d of loadDictations()) fs.writeFileSync(path.join(dir, `${d.id}.txt`), d.text);
    return true;
  }
  return false;
}

// ── Affichage ──────────────────────────────────────────────
const ORDER = ['imprime', 'tableau', 'manuscrit', 'capture', 'pdf-texte', 'pdf-scanne', 'dictee'];
const SOURCE = { texte: 'texte parfait', vision: 'Apple Vision', pdfjs: 'pdf.js (app)', tesseract: 'Tesseract (approx.)', sfspeech: 'SFSpeechRecognizer', whisper: 'whisper.cpp' };
function table(r, md) {
  const rows = Object.values(r.by).sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || Object.keys(SOURCE).indexOf(a.source) - Object.keys(SOURCE).indexOf(b.source));
  const head = ['Catégorie', 'Lu par', 'Docs', 'Lignes', 'Justes', 'Exercice', 'Prescription', 'En trop', 'Séances justes'];
  const body = rows.map(b => [b.kind, SOURCE[b.source], b.docs, b.lines, pct(b.lineRate), pct(b.exRate), pct(b.prRate), b.extra, `${b.sessionsOk}/${b.docs}`]);
  const out = [];
  if (md) {
    out.push(`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...body.map(x => `| ${x.join(' | ')} |`));
    for (const [title, list] of [['Erreurs les plus fréquentes : vraies lectures (Apple Vision, pdf.js, SFSpeech, whisper)', r.top], ['Erreurs les plus fréquentes : moteur seul (texte parfait)', r.topEngine]]) {
      out.push('', `**${title}**`, '', '| # | Erreur | Fois | Docs | Exemple |', '|---|---|---|---|---|');
      list.forEach((t, i) => out.push(`| ${i + 1} | ${t.family} | ${t.n} | ${t.docs} | ${t.ex.id} (${SOURCE[t.ex.source]}) : « ${String(t.ex.line).slice(0, 60).replace(/[|\t]/g, ' ')} » → ${t.ex.why.replace(/[|\t]/g, ' ')} |`));
    }
  } else {
    const w = head.map((h, i) => Math.max(h.length, ...body.map(x => String(x[i]).length)));
    out.push(head.map((h, i) => h.padEnd(w[i])).join('  '), ...body.map(x => x.map((v, i) => (i < 2 ? String(v).padEnd(w[i]) : String(v).padStart(w[i]))).join('  ')));
    for (const [title, list] of [['vraies lectures (Apple Vision, pdf.js, SFSpeech, whisper)', r.top], ['moteur seul (texte parfait)', r.topEngine]]) {
      out.push('', `Erreurs les plus fréquentes, ${title} :`);
      list.forEach((t, i) => out.push(`${String(i + 1).padStart(2)}. ${t.family} : ${t.n} fois, ${t.docs} docs\n    ex. ${t.ex.id} (${SOURCE[t.ex.source]}) « ${String(t.ex.line).slice(0, 70).replace(/\t/g, ' ')} » → ${t.ex.why}`));
    }
  }
  // Dictée par voix et par reconnaissance : la voix de synthèse pèse lourd (Eddy et Flo, synthèse Eloquence, robotiques)
  const voices = {};
  for (const c of r.cases.filter(x => x.kind === 'dictee' && x.variant)) {
    const b = (voices[`${SOURCE[c.source]} · ${c.variant.replace('frenchfrance', '')}`] ||= { lines: 0, ok: 0, exOk: 0, prOk: 0, extra: 0 });
    b.lines += c.lines; b.ok += c.ok; b.exOk += c.exOk; b.prOk += c.prOk; b.extra += c.extra;
  }
  const vrows = Object.entries(voices).sort().map(([k, b]) => [k, pct(b.ok / Math.max(1, b.lines + b.extra)), pct(b.exOk / Math.max(1, b.lines)), pct(b.prOk / Math.max(1, b.lines))]);
  if (vrows.length) {
    out.push('', md ? '**Dictée par voix (mots/min)**' : 'Dictée par voix (mots/min) :');
    if (md) out.push('', '| Reconnaissance · voix | Justes | Exercice | Prescription |', '|---|---|---|---|', ...vrows.map(x => `| ${x.join(' | ')} |`));
    else out.push(...vrows.map(x => `  ${x[0].padEnd(34)} ${x[1].padStart(7)}  ${x[2].padStart(7)}  ${x[3].padStart(7)}`));
  }
  const local = r.docs.filter(d => d.where === 'local');
  out.push('', `Documents : ${r.docs.length} (${r.docs.length - local.length} versionnés, ${local.length} locaux non libres) ; dictées : ${r.dictations.length} scripts.`);
  if (r.missing.ocr.length) out.push(`Sans lecture Apple Vision : ${r.missing.ocr.length} (${r.missing.ocr.filter(d => d.where === 'local').length} locaux, jamais envoyés sur GitHub).`);
  if (r.missing.stt) out.push('Aucune transcription SFSpeechRecognizer trouvée.');
  return out.join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) && !prepare()) {
  const r = measureReal();
  if (argv.includes('--json')) { console.log(JSON.stringify({ by: r.by, top: r.top, topEngine: r.topEngine, cases: r.cases.map(c => ({ ...c, text: undefined })) }, null, 1)); process.exit(0); }
  console.log(table(r, argv.includes('--markdown')));
  if (argv.includes('--erreurs')) {
    for (const c of r.cases.filter(x => x.errors.length && x.source !== 'texte')) {
      console.log(`\n${c.id} [${c.kind}, ${SOURCE[c.source]}${c.variant ? ` ${c.variant}` : ''}] ${c.ok}/${c.lines}${c.extra ? `, ${c.extra} en trop` : ''}${c.sessionsExp !== c.sessionsGot ? `, séances ${c.sessionsGot} au lieu de ${c.sessionsExp}` : ''}`);
      c.errors.forEach(e => console.log(`  ${String(e.line).slice(0, 60).padEnd(60)}  ${e.why.join(' ; ')}`));
    }
  }
}
