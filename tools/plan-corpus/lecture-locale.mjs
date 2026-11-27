// ═══════════════════════════════════════════════════════════
//  Lecture, SUR CE PC, des documents non libres du corpus réel (ceux qui ne vont jamais sur GitHub,
//  tests/fixtures/plans/reels/SOURCES.md). Sorties dans $CORPUS_LOCAL/sorties, lues par mesure-reel.mjs.
//  - PDF avec couche texte : pdf.js embarqué (vendor/pdfjs), mêmes options et même placement que
//    js/features/plan-pdf.js → <id>.pdfjs.json { boxes } : c'est le vrai chemin de l'app pour un PDF texte.
//  - Images et PDF scannés : Tesseract 5 (fra+eng), pages au format de PlanReader → <id>.tesseract.json.
//    APPROXIMATION seulement : ce n'est pas Apple Vision (aucun Mac ici), les chiffres sont rangés à part.
//  node tools/plan-corpus/lecture-locale.mjs [--force]
//  Demande : tesseract (fra, eng) et pdftoppm (poppler) dans le PATH.
// ═══════════════════════════════════════════════════════════
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadReal } from './mesure-reel.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LOCAL = process.env.CORPUS_LOCAL || path.join(os.homedir(), '.local', 'share', 'mdlf', 'corpus-import');
const OUT = path.join(LOCAL, 'sorties');
const force = process.argv.includes('--force');

function fileOf(d) {
  for (const dir of ['brut-images', 'brut-pdf'].map(x => path.join(LOCAL, x))) {
    if (!fs.existsSync(dir)) continue;
    const hit = fs.readdirSync(dir).find(f => path.parse(f).name === (d.source_id || d.id) && !f.endsWith('.json'));
    if (hit) return path.join(dir, hit);
  }
  return null;
}

// pdf.js du dépôt, chargé comme module (les fichiers embarqués finissent en .js : copie en .mjs dans un dossier temporaire)
let pdfLib = null;
async function pdfjs() {
  if (pdfLib) return pdfLib;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfjs-'));
  for (const f of ['pdf.min.js', 'pdf.worker.min.js']) fs.copyFileSync(path.join(ROOT, 'vendor', 'pdfjs', f), path.join(tmp, f.replace(/\.js$/, '.mjs')));
  pdfLib = await import(path.join(tmp, 'pdf.min.mjs'));
  pdfLib.GlobalWorkerOptions.workerSrc = new URL(`file://${path.join(tmp, 'pdf.worker.min.mjs')}`).href;
  return pdfLib;
}

// Même placement que planPdfText (js/features/plan-pdf.js), sur les seules pages du programme
async function pdfBoxes(file, pages) {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(fs.readFileSync(file)), isEvalSupported: false, disableFontFace: true, useSystemFonts: false,
    enableXfa: false, stopAtErrors: false }).promise;
  const boxes = [];
  let top = 0;
  try {
    for (const n of pages?.length ? pages : Array.from({ length: Math.min(doc.numPages, 30) }, (_, i) => i + 1)) {
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      for (const it of content.items) {
        if (!it.str || !it.str.trim()) continue;
        const h = Math.abs(it.height || it.transform[3] || 10);
        boxes.push({ text: it.str, x: it.transform[4], y: top + vp.height - it.transform[5] - h, w: it.width || it.str.length * h * 0.5, h });
      }
      top += vp.height + 40;
      page.cleanup();
    }
  } finally {
    doc.destroy();
  }
  return boxes;
}

// Tesseract en TSV → page au format de PlanReader (lignes, mots, boîtes de 0 à 1, origine en haut à gauche)
function tesseractPage(png) {
  const tsv = execFileSync('tesseract', [png, 'stdout', '-l', 'fra+eng', '--psm', '3', 'tsv'], { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] });
  const rows = tsv.trim().split('\n').slice(1).map(l => l.split('\t'));
  const pageRow = rows.find(r => r[0] === '1');
  const W = +pageRow[8], H = +pageRow[9];
  const lines = new Map();
  for (const r of rows) {
    if (r[0] !== '5' || !r[11]?.trim() || +r[10] < 0) continue;
    const key = `${r[2]}.${r[3]}.${r[4]}`;
    const l = lines.get(key) || { words: [], conf: [] };
    l.words.push({ text: r[11], x: +r[6], y: +r[7], w: +r[8], h: +r[9] });
    l.conf.push(+r[10]);
    lines.set(key, l);
  }
  const b = (x, y, w, h) => ({ x: x / W, y: y / H, w: w / W, h: h / H });
  const out = [...lines.values()].map(l => {
    const x0 = Math.min(...l.words.map(w => w.x)), y0 = Math.min(...l.words.map(w => w.y));
    const x1 = Math.max(...l.words.map(w => w.x + w.w)), y1 = Math.max(...l.words.map(w => w.y + w.h));
    return { text: l.words.map(w => w.text).join(' '), confidence: l.conf.reduce((a, c) => a + c, 0) / l.conf.length / 100,
      box: b(x0, y0, x1 - x0, y1 - y0), words: l.words.map(w => ({ text: w.text, box: b(w.x, w.y, w.w, w.h) })) };
  });
  return { width: W, height: H, text: out.map(l => l.text).join('\n'), lines: out };
}

function tesseractPages(file, pages) {
  if (!file.endsWith('.pdf')) return [tesseractPage(file)];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-'));
  return (pages?.length ? pages : [1]).map(n => {
    const base = path.join(tmp, `p${n}`);
    execFileSync('pdftoppm', ['-r', '300', '-f', String(n), '-l', String(n), '-singlefile', '-png', file, base]);
    return tesseractPage(`${base}.png`);
  });
}

fs.mkdirSync(OUT, { recursive: true });
for (const d of loadReal()) {
  const file = fileOf(d);
  if (!file) { console.error(`${d.id} : fichier introuvable dans ${LOCAL}`); continue; }
  const isPdf = file.endsWith('.pdf');
  // Un PDF texte passe par pdf.js dans l'app ; un PDF sans couche texte et les images par la lecture d'image
  if (isPdf && d.category === 'pdf-texte') {
    const o = path.join(OUT, `${d.id}.pdfjs.json`);
    if (force || !fs.existsSync(o)) fs.writeFileSync(o, JSON.stringify({ id: d.id, tool: 'pdf.js 4.10.38 (vendor/pdfjs), placement de plan-pdf.js', boxes: await pdfBoxes(file, d.pages) }));
    console.log(`${d.id} : pdf.js`);
  }
  if (d.category !== 'pdf-texte') {
    const o = path.join(OUT, `${d.id}.tesseract.json`);
    if (force || !fs.existsSync(o)) fs.writeFileSync(o, JSON.stringify({ id: d.id, tool: 'Tesseract 5 fra+eng (approximation, pas Apple Vision)', pages: tesseractPages(file, d.pages) }));
    console.log(`${d.id} : Tesseract`);
  }
}
