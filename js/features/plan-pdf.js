// ═══════════════════════════════════════════════════════════
//  Importer un programme : texte d'un PDF (docs/IMPORT_PROGRAMME.md, « PDF »)
//  pdf.js 4.10.38 (Mozilla, Apache 2.0), version figée et embarquée dans vendor/pdfjs/ (aucun script venu d'Internet),
//  chargé seulement au premier PDF. Chaque morceau de texte garde sa position : les lignes et les colonnes d'un
//  tableau sont remises en place par planTextFromBoxes (js/data/plan-table.js), comme pour une photo.
//  Le PDF est une donnée non fiable : pas d'évaluation de code (isEvalSupported: false), 30 pages au plus.
// ═══════════════════════════════════════════════════════════
'use strict';

const PDF_PAGES_MAX = 30;
let pdfLibPromise = null;
function pdfLib() {
  if (!pdfLibPromise) {
    const base = new URL('vendor/pdfjs/', document.baseURI).href;
    pdfLibPromise = import(`${base}pdf.min.js`).then(lib => { lib.GlobalWorkerOptions.workerSrc = `${base}pdf.worker.min.js`; return lib; })
      .catch(err => { pdfLibPromise = null; throw err; });
  }
  return pdfLibPromise;
}

// { text, pages } : texte des pages, une page sous l'autre ; texte vide pour un PDF fait d'images (scan)
async function planPdfText(buffer) {
  const lib = await pdfLib();
  const doc = await lib.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, disableFontFace: true, useSystemFonts: false,
    enableXfa: false, stopAtErrors: false }).promise;
  const boxes = [];
  let top = 0;
  const pages = Math.min(doc.numPages, PDF_PAGES_MAX);
  try {
    for (let n = 1; n <= pages; n++) {
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      for (const it of content.items) {
        if (!it.str || !it.str.trim()) continue;
        const h = Math.abs(it.height || it.transform[3] || 10);
        boxes.push({ text: it.str, x: it.transform[4], y: top + vp.height - it.transform[5] - h, w: it.width || it.str.length * h * 0.5, h });
      }
      top += vp.height + 40;   // une ligne vide entre deux pages
      page.cleanup();
    }
  } finally {
    doc.destroy();
  }
  return { text: planTextFromBoxes(boxes), pages };
}
