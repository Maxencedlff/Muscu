// ═══════════════════════════════════════════════════════════
//  Mesure de l'import aidé par l'IA sur le CORPUS RÉEL (docs/IMPORT_IA.md, « Mesure »), en LOCAL seulement :
//  lance tools/plan-import-ia/serveur.ts (vrai cœur de plan-import-ai, vrai client d'Anthropic, clé lue dans
//  ~/.config/mdlf/anthropic_key, plafond de campagne PLAN_IA_PLAFOND_USD, 3 $ par défaut) et rejoue ce que ferait l'app :
//  moteur gratuit d'abord (planParse), aide proposée seulement s'il hésite (planAiAdvice), lignes douteuses seules
//  ou texte entier, résultat remis dans le brouillon (planAiApplyLines, planAiAdopt), puis le même score que le corpus
//  (scorePlan : exercice, prescription, séance, superset ; une ligne inventée compte fausse).
//
//  node tools/plan-import-ia/mesure.mjs --lots [--max N]   variantes (a) à (e) sur les lots apprentissage et contrôle
//  (tools/plan-corpus/lots.json), chiffres seuls : moteur seul, Haiku sur le texte, Haiku sur la photo, Sonnet sur la
//  photo, cascade retenue ; justesse, $ par import, part des imports sans aucun appel. Plafond : PLAN_IA_PLAFOND_USD.
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
const CORPUS = path.resolve(opt('--corpus', fs.existsSync(path.join(ROOT, 'tools', 'plan-corpus', 'lots.json')) ? ROOT : path.join(ROOT, '..', 'ppl-corpus-reel')));
const VARIANTS = opt('--variantes', 'seul,cascade,cache,image').split(',');
const MAX = Number(opt('--max', 1e9));
const OUT = path.join(os.homedir(), '.local', 'share', 'mdlf', 'import-ia');
const LEDGER = process.env.PLAN_IA_DEPENSE || path.join(OUT, 'depense.json');
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
  child.on('error', e => process.stderr.write(`[serveur] ${e.message}\n`));
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
async function runCase(c, port, route, { forcePlan = false, photo = null } = {}) {
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
  const mode = photo ? 'image' : forcePlan ? 'plan' : adv.mode;
  let final = engine, status = 0, answer = null;
  if (mode === 'image') {
    // Le moteur hésite sur la lecture de la photo : la photo part (second accord dans l'app), son résultat remplace le brouillon
    const res = await post(port, route, { mode: 'image', consent: true, image: { media_type: 'image/jpeg', data: smallJpeg(photo) } });
    add(res.body.usage); status = res.status; answer = res.body;
    if (res.status === 200) final = scorePlan(c.truth, ctx.planAiAdopt(res.body.draft, null));
  } else if (mode === 'plan') {
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
if (argv.includes('--lots')) { await lotsCampaign(); process.exit(0); }
const all = cases().slice(0, MAX);
const textCases = all.filter(c => !c.image), imageCases = all.filter(c => c.image);
console.log(`Corpus : ${textCases.length} lectures (Vision ${textCases.filter(c => c.source === 'vision').length}, pdf.js ${textCases.filter(c => c.source === 'pdfjs').length}, dictées SFSpeech ${textCases.filter(c => c.source === 'sfspeech').length}), ${imageCases.length} photos.`);
fs.mkdirSync(OUT, { recursive: true, mode: 0o700 });
const CAP = Number(process.env.PLAN_IA_PLAFOND_USD || 3);
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
        if (s > CAP - 0.15) { if (!stop) console.log(`Plafond de campagne presque atteint (${s.toFixed(3)} $) : arrêt.`); stop = true; break; }
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

// ── Les deux lots, variantes (a) à (e) ─────────────────────
// Un import par document (lecture réelle : Apple Vision, sinon pdf.js de l'app, sinon Tesseract en approximation pour
// les photos locales sans sortie Vision) et par dictée reconnue (SFSpeechRecognizer, chaque voix). Une source photo
// est un document dont le fichier est une image (versionnée ou locale, envoyée seulement à Anthropic, jamais sur GitHub).
// Le lot de contrôle ne montre que des chiffres : ni ses erreurs ni ses textes ne sont affichés (anti sur-adaptation).
function lotImports() {
  const LOTS = readJson(path.join(CORPUS, 'tools', 'plan-corpus', 'lots.json'));
  const lotOf = id => (LOTS.apprentissage.includes(id) ? 'apprentissage' : LOTS.controle.includes(id) ? 'controle' : null);
  const out = [];
  for (const d of loadReal()) {
    const lot = lotOf(d.id);
    if (!lot) continue;
    let source = null, text = null;
    const o = outFile(`${d.id}.ocr.json`), p = outFile(`${d.id}.pdfjs.json`), t = outFile(`${d.id}.tesseract.json`);
    if (o) { source = 'vision'; text = ctx.planTextFromPages(readJson(o).pages); }
    else if (p) { source = 'pdfjs'; text = ctx.planTextFromBoxes(readJson(p).boxes); }
    else if (t) { source = 'tesseract'; text = ctx.planTextFromPages(readJson(t).pages); }
    if (!source) continue;
    const isImg = /\.(jpe?g|png)$/i.test(d.file || '');
    const photo = isImg ? [path.join(REELS, 'fichiers', d.file), path.join(LOCAL, 'brut-images', d.file)].find(f => fs.existsSync(f)) || null : null;
    out.push({ id: d.id, lot, kind: d.category, source, truth: d, text, photo });
  }
  for (const d of loadDictations()) {
    const lot = lotOf(d.id);
    if (!lot) continue;
    for (const f of fs.readdirSync(path.join(REELS, 'sorties')).filter(x => x.startsWith(`${d.id}__`) && x.endsWith('.stt.json')).sort()) {
      const r = readJson(path.join(REELS, 'sorties', f));
      if (r.text) out.push({ id: `${d.id}·${f.slice(d.id.length + 2, -9)}`, lot, kind: 'dictee', source: 'sfspeech', truth: d, text: r.text, photo: null });
    }
  }
  return out;
}

async function lotsCampaign() {
  const imports = lotImports().slice(0, MAX);
  const photos = imports.filter(c => c.photo);
  console.log(`Imports : ${imports.length} (apprentissage ${imports.filter(c => c.lot === 'apprentissage').length}, contrôle ${imports.filter(c => c.lot === 'controle').length}), dont ${photos.length} sources photo.`);
  fs.mkdirSync(OUT, { recursive: true, mode: 0o700 });
  const CAP = Number(process.env.PLAN_IA_PLAFOND_USD || 3);
  const srv = await startServer();
  const spent = async () => (await (await fetch(`http://127.0.0.1:${srv.port}/depense`)).json()).usd;
  // (a) moteur seul ; (b) Haiku sur le texte ; (c) Haiku sur la photo ; (d) Sonnet sur la photo ; (e) cascade retenue
  // (montée vers Sonnet sur échec de la validation, sans cache de résultats : coût d'un premier import). (c), (d) et
  // (e) ne diffèrent de (b) que pour les sources photo : les autres imports reprennent le résultat de (b) ou (e).
  const ROUTE_E = process.env.PLAN_IA_ROUTE_E || 'sans-cache';
  const steps = [
    ['a', null, imports, {}],
    ['b', 'seul', imports, {}],
    ['c', 'seul', photos, { photo: true }],
    ['d', 'sonnet-photo', photos, { photo: true }],
    ['e', ROUTE_E, imports, { photo: !!process.env.PLAN_IA_E_PHOTO }],
  ].filter(s => (opt('--variantes-lots', 'a,b,c,d,e').split(',')).includes(s[0]));
  const res = {};
  // Reprise : variantes déjà mesurées dans un rapport précédent (--reprendre FICHIER), pour ne pas repayer
  const prev = opt('--reprendre', null) ? readJson(opt('--reprendre', null)) : null;
  const report = { at: new Date().toISOString(), lots: {} };
  if (prev) {
    const byId = new Map(imports.map(c => [c.id, c]));
    for (const [k, rows] of Object.entries(prev.lots)) {
      const v = k.split('|')[1];
      if (steps.some(s => s[0] === v)) continue;
      res[v] ||= new Map();
      for (const r of rows) if (byId.has(r.id)) res[v].set(r.id, { c: byId.get(r.id), final: { ok: r.ok, lines: r.lines, extra: r.extra, errors: r.errors || [] }, usage: r.usage, mode: r.mode, status: r.status });
    }
  }
  try {
    for (const [v, route, list, o] of steps) {
      const rows = [];
      let next = 0, stop = false;
      const worker = async () => {
        while (!stop && next < list.length) {
          const c = list[next++];
          if (route) { const s = await spent(); if (s > CAP - 0.15) { if (!stop) console.log(`Plafond presque atteint (${s.toFixed(3)} $) : arrêt de ${v}.`); stop = true; break; } }
          try {
            const r = route ? await runCase(c, srv.port, route, { photo: o.photo && c.photo ? c.photo : null }) : (() => { const e = scorePlan(c.truth, ctx.planParse(c.text)); return { engine: e, final: e, usage: { usd: 0, calls: 0, sonnetCalls: 0, escalated: 0 }, asked: false }; })();
            rows.push({ c, ...r });
          } catch (e) { console.error(c.id, e.message); }
        }
      };
      // Photos : 2 à la fois (au-delà, des appels dépassent le délai de 55 s depuis ce poste)
      const n = !route ? 1 : o.photo ? Number(process.env.PLAN_IA_PARALLELE_PHOTO || 2) : Number(process.env.PLAN_IA_PARALLELE || 3);
      await Promise.all(Array.from({ length: n }, worker));
      res[v] = new Map(rows.map(r => [r.c.id, r]));
      console.log(`${v} : ${rows.length}/${list.length} imports, dépense cumulée ${(await spent()).toFixed(4)} $`);
    }
  } finally {
    report.spentUsd = await spent().catch(() => null);
    srv.stop();
  }
  // Un import sous une variante : son propre résultat, sinon celui de (b) (photo non concernée), sinon le moteur seul
  const pick = (v, c) => res[v]?.get(c.id) || (v === 'c' || v === 'd' ? res.b?.get(c.id) : null);
  const head = ['Lot', 'Variante', 'Imports', 'Justes', 'Photos : justes', '$ / import', '$ / import photo', 'Sans appel', 'Appels Sonnet'];
  const body = [];
  for (const lot of ['controle', 'apprentissage']) {
    const L = imports.filter(c => c.lot === lot);
    for (const v of ['a', 'b', 'c', 'd', 'e']) {
      if (!res[v]) continue;
      const rows = L.map(c => pick(v, c)).filter(Boolean);
      if (rows.length < L.length) { body.push([lot, v, `${rows.length}/${L.length} (incomplet)`, '', '', '', '', '', '']); continue; }
      const ph = rows.filter(r => r.c.photo);
      const usd = rs => rs.reduce((n, r) => n + r.usage.usd, 0) / Math.max(1, rs.length);
      body.push([lot, v, rows.length, pct(rate(rows.map(r => r.final))), ph.length ? `${pct(rate(ph.map(r => r.final)))} (${ph.length})` : '—',
        usd(rows).toFixed(5), ph.length ? usd(ph).toFixed(5) : '—', pct(rows.filter(r => !r.usage.calls).length / rows.length), rows.reduce((n, r) => n + r.usage.sonnetCalls, 0)]);
      report.lots[`${lot}|${v}`] = rows.map(r => ({ id: r.c.id, source: r.c.source, photo: !!r.c.photo, mode: r.mode ?? null, status: r.status ?? null, ok: r.final.ok, lines: r.final.lines, extra: r.final.extra, usage: r.usage,
        // Erreurs gardées pour l'apprentissage seulement (fichier local) : le contrôle ne donne que des chiffres
        errors: lot === 'apprentissage' ? r.final.errors : undefined }));
    }
  }
  const w = head.map((h, i) => Math.max(h.length, ...body.map(x => String(x[i]).length)));
  console.log([head, ...body].map(x => x.map((s, i) => String(s).padEnd(w[i])).join('  ')).join('\n'));
  const f = path.join(OUT, `lots-${report.at.replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(f, JSON.stringify(report, null, 1), { mode: 0o600 });
  console.log(`\nDépense totale de la campagne : ${report.spentUsd?.toFixed(4)} $ (plafond ${CAP} $) ; détail local, hors dépôt : ${f}`);
}
