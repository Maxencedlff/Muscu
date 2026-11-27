// ═══════════════════════════════════════════════════════════
//  Mesure de l'import aidé par l'IA sur le CORPUS RÉEL (docs/IMPORT_IA.md, « Mesure »), en LOCAL seulement :
//  lance tools/plan-import-ia/serveur.ts (vrai cœur de plan-import-ai, vrai client d'Anthropic, clé lue dans
//  ~/.config/mdlf/anthropic_key, plafond de campagne PLAN_IA_PLAFOND_USD, 3 $ par défaut) et rejoue ce que ferait l'app :
//  moteur gratuit d'abord (planParse), aide proposée seulement s'il hésite (planAiAdvice), lignes douteuses seules
//  ou texte entier, résultat remis dans le brouillon (planAiApplyLines, planAiAdopt), puis le même score que le corpus
//  (scorePlan : exercice, prescription, séance, superset ; une ligne inventée compte fausse).
//
//  node tools/plan-import-ia/mesure.mjs [--corpus DOSSIER] [--variantes seul,cascade,cache,image,image-seul,doute,cascade-docs,ecrit,plan] [--max N]
//  Corpus : DOSSIER (défaut ../ppl-corpus-reel, branche corpus-reel) : lectures Apple Vision (*.ocr.json), pdf.js de
//  l'app (*.pdfjs.json, documents locaux), dictées reconnues par SFSpeechRecognizer (*.stt.json), photos (fichiers/).
//  Résultats complets (textes lus, réponses) : ~/.local/share/mdlf/import-ia/, JAMAIS dans le dépôt (public).
// ═══════════════════════════════════════════════════════════
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { planEngine } from '../plan-corpus/mesure.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const CORPUS = path.resolve(opt('--corpus', path.join(ROOT, '..', 'ppl-corpus-reel')));
const VARIANTS = opt('--variantes', 'seul,cascade,cache,image').split(',');
const MAX = Number(opt('--max', 1e9));
const OUT = path.join(os.homedir(), '.local', 'share', 'mdlf', 'import-ia');
const LEDGER = path.join(OUT, 'depense.json');
const KEY = process.env.PLAN_IA_CLE || path.join(os.homedir(), '.config', 'mdlf', 'anthropic_key');
if (!fs.existsSync(KEY)) { console.error(`Clé absente (${KEY}) : rien n'est lancé.`); process.exit(2); }

const { loadReal, loadDictations } = await import(path.join(CORPUS, 'tools', 'plan-corpus', 'mesure-reel.mjs'));
const { scorePlan } = await import(path.join(CORPUS, 'tests', 'unit', 'plan-corpus-lib.mjs'));
const REELS = path.join(CORPUS, 'tests', 'fixtures', 'plans', 'reels');
const LOCAL = process.env.CORPUS_LOCAL || path.join(os.homedir(), '.local', 'share', 'mdlf', 'corpus-import');

// Moteur de l'app (cette branche) et la logique de renfort, dans le même contexte que dans l'app
const ctx = planEngine();
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/data/plan-ai.js'), 'utf8'), ctx, { filename: 'js/data/plan-ai.js' });
const clone = o => JSON.parse(JSON.stringify(o));

// ── Cas ────────────────────────────────────────────────────
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const outFile = name => [path.join(REELS, 'sorties', name), path.join(LOCAL, 'sorties', name)].find(f => fs.existsSync(f));
function cases() {
  const out = [];
  for (const d of loadReal()) {
    const o = outFile(`${d.id}.ocr.json`);
    if (o) out.push({ id: d.id, kind: d.category, source: 'vision', truth: d, text: ctx.planTextFromPages(readJson(o).pages) });
    const p = outFile(`${d.id}.pdfjs.json`);
    if (p) out.push({ id: d.id, kind: d.category, source: 'pdfjs', truth: d, text: ctx.planTextFromBoxes(readJson(p).boxes) });
    const img = d.where === 'depot' && /\.(jpe?g|png)$/i.test(d.file || '') ? path.join(REELS, 'fichiers', d.file) : null;
    if (img && fs.existsSync(img)) out.push({ id: d.id, kind: d.category, source: 'image', truth: d, image: img });
  }
  for (const d of loadDictations()) {
    for (const f of fs.readdirSync(path.join(REELS, 'sorties')).filter(x => x.startsWith(`${d.id}__`) && x.endsWith('.stt.json')).sort()) {
      const r = readJson(path.join(REELS, 'sorties', f));
      if (r.text) out.push({ id: `${d.id}·${f.slice(d.id.length + 2, -9)}`, kind: 'dictee', source: 'sfspeech', truth: d, text: r.text });
    }
  }
  return out;
}

// Photo réduite à 1600 px sur le grand côté, JPEG 85 (comme l'app avant l'envoi)
function smallJpeg(file) {
  const code = 'import sys,io,base64\nfrom PIL import Image,ImageOps\nim=ImageOps.exif_transpose(Image.open(sys.argv[1])).convert("RGB")\nim.thumbnail((1600,1600))\nb=io.BytesIO();im.save(b,"JPEG",quality=85)\nsys.stdout.write(base64.b64encode(b.getvalue()).decode())';
  // Code en ligne, lancé hors du dossier de l'image (le paquet Pillow est installé pour l'utilisateur : pas de -I)
  return execFileSync('python3', ['-c', code, file], { maxBuffer: 20e6, cwd: os.tmpdir() }).toString();
}

// ── Serveur local ──────────────────────────────────────────
async function startServer() {
  const deno = process.env.DENO || path.join(os.homedir(), '.deno', 'bin', 'deno');
  const child = spawn(deno, ['run', '--config', path.join(ROOT, 'supabase/functions/deno.json'), '--allow-net=127.0.0.1,api.anthropic.com',
    `--allow-read=${KEY},${ROOT},${LEDGER}`, `--allow-write=${LEDGER}`, '--allow-env', path.join(ROOT, 'tools/plan-import-ia/serveur.ts')], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, MDLF_EDGE_TESTS: '1', PLAN_IA_DEPENSE: LEDGER } });
  child.stderr.on('data', b => { const s = String(b); if (!/^\s*$/.test(s)) process.stderr.write(`[serveur] ${s}`); });
  const port = await new Promise((res, rej) => {
    let buf = '';
    child.stdout.on('data', b => { buf += b; const m = /PORT (\d+)/.exec(buf); if (m) res(+m[1]); });
    child.on('exit', c => rej(new Error(`serveur arrêté (${c})`)));
    setTimeout(() => rej(new Error('serveur muet')), 60000);
  });
  return { port, stop: () => child.kill() };
}

// ── Un import, comme l'app ─────────────────────────────────
async function post(port, route, body) {
  const r = await fetch(`http://127.0.0.1:${port}/${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
async function runCase(c, port, route, { forcePlan = false } = {}) {
  const usage = { usd: 0, calls: 0, escalated: 0, cached: 0, sonnetCalls: 0 };
  const add = u => { if (!u) return; usage.usd += u.usd || 0; usage.calls += u.calls?.length || 0; usage.escalated += u.escalated || 0; usage.cached += u.cached || 0;
    usage.sonnetCalls += (u.calls || []).filter(x => x.model.includes('sonnet')).length; };
  if (c.image) {
    const res = await post(port, route, { mode: 'image', consent: true, image: { media_type: 'image/jpeg', data: smallJpeg(c.image) } });
    add(res.body.usage);
    const d = res.status === 200 ? ctx.planAiAdopt(res.body.draft, null) : { sessions: [] };
    return { engine: null, final: scorePlan(c.truth, d), usage, asked: true, mode: 'image', status: res.status, answer: res.body };
  }
  const draft = ctx.planParse(c.text);
  const engine = scorePlan(c.truth, draft);
  const adv = ctx.planAiAdvice(draft, { text: c.text });
  if (!adv.propose && !forcePlan) return { engine, final: engine, usage, asked: false, mode: null };
  const mode = forcePlan ? 'plan' : adv.mode;
  let final = engine, status = 0, answer = null;
  if (mode === 'plan') {
    const res = await post(port, route, clone(ctx.planAiPlanBody(c.text)));
    add(res.body.usage); status = res.status; answer = res.body;
    if (res.status === 200) final = scorePlan(c.truth, ctx.planAiAdopt(res.body.draft, null));
  } else if (mode === 'lines') {
    const res = await post(port, route, clone(ctx.planAiLinesBody(draft, adv.targets)));
    add(res.body.usage); status = res.status; answer = res.body;
    if (res.status === 200) { ctx.planAiApplyLines(draft, adv.targets, res.body.results); final = scorePlan(c.truth, draft); }
  }
  return { engine, final, usage, asked: true, mode, status, answer };
}

// ── Campagne ───────────────────────────────────────────────
const pct = v => `${(v * 100).toFixed(1).replace('.', ',')} %`;
const rate = list => { const t = list.reduce((s, r) => ({ ok: s.ok + r.ok, n: s.n + r.lines + r.extra }), { ok: 0, n: 0 }); return t.n ? t.ok / t.n : NaN; };
function summary(name, rows) {
  const by = {};
  for (const r of rows) (by[r.c.source] ||= []).push(r);
  const lines = [`\n== ${name} ==`, 'Lu par      Imports  Sans modèle  Moteur seul  Final     $/import  Appels  Sonnet  Lignes montées'];
  const fmt = (label, rs) => {
    const usd = rs.reduce((n, r) => n + r.usage.usd, 0), noModel = rs.filter(r => !r.usage.calls).length;
    const eng = rs.filter(r => r.engine).map(r => r.engine);
    lines.push(`${label.padEnd(11)} ${String(rs.length).padStart(7)}  ${pct(noModel / rs.length).padStart(11)}  ${(eng.length ? pct(rate(eng)) : '—').padStart(11)}  ${pct(rate(rs.map(r => r.final))).padStart(7)}  ${(usd / rs.length).toFixed(5).padStart(8)}  ${String(rs.reduce((n, r) => n + r.usage.calls, 0)).padStart(6)}  ${String(rs.reduce((n, r) => n + r.usage.sonnetCalls, 0)).padStart(6)}  ${String(rs.reduce((n, r) => n + r.usage.escalated, 0)).padStart(14)}`);
    return usd;
  };
  let tot = 0;
  for (const [k, rs] of Object.entries(by)) tot += fmt(k, rs);
  fmt('TOUT', rows);
  lines.push(`Dépense de la variante : ${tot.toFixed(4)} $`);
  return lines.join('\n');
}

// Corpus écrit (tests/fixtures/plans : 54 plans écrits à l'aveugle et leurs variantes simulées) : le cas courant
const { loadCorpus, corpusCases } = await import(path.join(ROOT, 'tests', 'unit', 'plan-corpus-lib.mjs'));
const written = corpusCases(loadCorpus(ROOT)).map((c, i) => ({ id: `${c.plan.id}#${i}`, kind: c.kind, source: `ecrit-${c.kind}`, truth: c.plan,
  text: c.input.boxes ? ctx.planTextFromBoxes(c.input.boxes) : c.input.text }));
const all = cases().slice(0, MAX);
const textCases = all.filter(c => !c.image), imageCases = all.filter(c => c.image);
console.log(`Corpus : ${textCases.length} lectures (Vision ${textCases.filter(c => c.source === 'vision').length}, pdf.js ${textCases.filter(c => c.source === 'pdfjs').length}, dictées SFSpeech ${textCases.filter(c => c.source === 'sfspeech').length}), ${imageCases.length} photos.`);
fs.mkdirSync(OUT, { recursive: true, mode: 0o700 });
const srv = await startServer();
const report = { at: new Date().toISOString(), variants: {} };
const spent = async () => (await (await fetch(`http://127.0.0.1:${srv.port}/depense`)).json()).usd;
try {
  const plan = { seul: ['seul', textCases, {}], cascade: ['cascade', textCases, {}], cache: ['cascade', textCases, {}], image: ['cascade', imageCases, {}],
    'image-seul': ['seul', imageCases, {}], doute: ['doute', textCases, {}],
    'cascade-docs': ['cascade', textCases.filter(c => c.source !== 'sfspeech'), {}], ecrit: ['cascade', written.slice(0, MAX), {}], plan: ['cascade', textCases.filter(c => c.source !== 'sfspeech'), { forcePlan: true }] };
  for (const v of VARIANTS) {
    if (!plan[v]) { console.error(`variante inconnue : ${v}`); continue; }
    const [route, list, o] = plan[v];
    // 4 imports à la fois ; le serveur refuse de lui-même tout appel qui ferait passer la campagne au-dessus du plafond
    const rows = [];
    let next = 0, stop = false;
    const worker = async () => {
      while (!stop && next < list.length) {
        const c = list[next++];
        const s = await spent();
        if (s > 2.85) { if (!stop) console.log(`Plafond de campagne presque atteint (${s.toFixed(3)} $) : arrêt.`); stop = true; break; }
        try { rows.push({ c, ...(await runCase(c, srv.port, route, o)) }); } catch (e) { console.error(c.id, e.message); }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    console.log(summary(v, rows));
    report.variants[v] = rows.map(r => ({ id: r.c.id, source: r.c.source, kind: r.c.kind, asked: r.asked, mode: r.mode, status: r.status,
      engine: r.engine && { ok: r.engine.ok, lines: r.engine.lines, extra: r.engine.extra }, final: { ok: r.final.ok, lines: r.final.lines, extra: r.final.extra, errors: r.final.errors },
      usage: r.usage, answer: r.answer }));
  }
} finally {
  report.spentUsd = await spent().catch(() => null);
  srv.stop();
  fs.mkdirSync(OUT, { recursive: true, mode: 0o700 });
  const f = path.join(OUT, `mesure-${report.at.replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(f, JSON.stringify(report, null, 1), { mode: 0o600 });
  console.log(`\nDépense totale de la campagne : ${report.spentUsd?.toFixed(4)} $ ; détail (local, hors dépôt) : ${f}`);
}
