// ═══════════════════════════════════════════════════════════
//  Récaps : dessin de l'image story (1080 × 1920) d'un écran
// ═══════════════════════════════════════════════════════════
'use strict';

// Même gabarit que l'image d'une séance (share-canvas.js) : format story, zones d'Instagram (STORY.TOP,
// STORY.BOTTOM), polices système, cartes, signature « MDLF Training » en bas ; l'image reprend les
// aides de dessin de share-canvas.js (storyFont, fitSize, drawCard, drawBackground, drawSignature,
// drawMedal). Un écran = un chiffre énorme (SF Rounded), sa légende, une note ; les records et le
// résumé ajoutent une carte. Lisible en vignette : chiffre ≥ 120 px, rien sous 32 px.
const RECAP_STORY = {
  KICKER: 36,       // « TA SEMAINE »
  SUB: 36,          // « 19 – 25 octobre »
  NUM_MAX: 260, NUM_MIN: 120,   // valeur numérique
  TXT_MAX: 136, TXT_MIN: 72,    // valeur texte (nom d'exercice, de muscle, de jour), jusqu'à 3 lignes
  CAPTION: 56,
  NOTE: 40,
  ROW: 96,          // ligne d'une liste (records, résumé)
  TILE: 200,        // tuile du résumé
  GAP: 24,
};

// Coupe un texte en lignes qui tiennent dans maxW (mots entiers), maxLines au plus ; la dernière est tronquée
function recapWrap(ctx, text, maxW, maxLines) {
  const words = String(text).split(/\s+/).filter(Boolean), lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(next).width <= maxW || !cur) cur = next;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = fitText(ctx, lines.slice(maxLines - 1).join(' ') + ' …', maxW); }
  return lines.map(l => fitText(ctx, l, maxW));
}

// Taille et lignes d'une valeur texte : la plus grande taille qui tient en 2 lignes, sinon 3 lignes au minimum
function recapTextBlock(ctx, p, text, maxW) {
  for (let size = RECAP_STORY.TXT_MAX; size >= RECAP_STORY.TXT_MIN; size -= 8) {
    ctx.font = storyFont(800, size, false, p);
    const lines = recapWrap(ctx, text, maxW, 3);
    if (lines.length <= 2 || size === RECAP_STORY.TXT_MIN) return { size, lines };
  }
  ctx.font = storyFont(800, RECAP_STORY.TXT_MIN, false, p);
  return { size: RECAP_STORY.TXT_MIN, lines: recapWrap(ctx, text, maxW, 3) };
}

// Hauteur et dessin du bloc central (valeur, légende, note). draw : false mesure seulement.
function recapHero(ctx, p, page, y, draw) {
  const { SIDE, W } = STORY, maxW = W - 2 * SIDE;
  let h = 0;
  const put = (text, font, color, lh, tracking = 0) => {
    ctx.font = font; setTracking(ctx, tracking);
    if (draw) { ctx.fillStyle = rgbaCss(color); ctx.fillText(fitText(ctx, text, maxW), SIDE, y + h + lh * 0.78); }
    setTracking(ctx, 0);
    h += lh;
  };
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  if (page.text) {
    const { size, lines } = recapTextBlock(ctx, p, page.value, maxW);
    lines.forEach(l => put(l, storyFont(800, size, false, p), p.label, Math.round(size * 1.08), -size * .02));
  } else {
    const size = fitSize(ctx, page.value, maxW, RECAP_STORY.NUM_MAX, RECAP_STORY.NUM_MIN, s => storyFont(800, s, true, p));
    put(page.value, storyFont(800, size, true, p), p.label, Math.round(size * 1.02), -size * .03);
  }
  if (page.caption) { h += 8; put(page.caption, storyFont(600, RECAP_STORY.CAPTION, false, p), p.label2, Math.round(RECAP_STORY.CAPTION * 1.25)); }
  if (page.note)    { h += 20; put(page.note, storyFont(500, RECAP_STORY.NOTE, false, p), p.catText, Math.round(RECAP_STORY.NOTE * 1.3)); }
  return h;
}

// Carte de lignes « nom … valeur » (records : médaille et valeur en or). Renvoie sa hauteur.
function recapRows(ctx, p, rows, y, draw, { medal = false } = {}) {
  const { SIDE, W, ROW } = { ...STORY, ROW: RECAP_STORY.ROW }, w = W - 2 * SIDE, padX = 44, h = rows.length * ROW + 24;
  if (!draw) return h;
  drawCard(ctx, p, SIDE, y, w, h);
  rows.forEach((r, i) => {
    const ry = y + 12 + i * ROW, base = ry + ROW * 0.62;
    if (i) { ctx.fillStyle = rgbaCss(p.sep); ctx.fillRect(SIDE + padX, ry, w - 2 * padX, 2); }
    const x = SIDE + padX + (medal ? 56 : 0);
    if (medal) drawMedal(ctx, p, SIDE + padX - 4, ry + (ROW - 44) / 2, 44);
    // Records : nom d'exercice à gauche, série à droite ; résumé : libellé court à gauche, valeur (souvent un nom) à droite
    ctx.font = storyFont(600, 30, false, p);
    const valMax = medal ? (w - 2 * padX) * 0.45 : Math.max((w - 2 * padX) * 0.45, w - 2 * padX - ctx.measureText(r.name).width - 32);
    fitSize(ctx, r.value, valMax, 36, 28, s => storyFont(700, s, true, p));
    const vw = Math.min(ctx.measureText(r.value).width, valMax);
    ctx.fillStyle = rgbaCss(medal ? p.goldText : p.label); ctx.textAlign = 'right';
    ctx.fillText(fitText(ctx, r.value, valMax), SIDE + w - padX, base); ctx.textAlign = 'left';
    const nameW = w - 2 * padX - vw - 28 - (medal ? 56 : 0);
    fitSize(ctx, r.name, nameW, 36, 30, s => storyFont(600, s, false, p));
    ctx.fillStyle = rgbaCss(medal ? p.label : p.label2);
    ctx.fillText(fitText(ctx, r.name, nameW), x, base);
  });
  return h;
}

// Tuiles du résumé, deux par ligne. Renvoie la hauteur.
function recapTiles(ctx, p, tiles, y, draw) {
  const { SIDE, W } = STORY, gap = RECAP_STORY.GAP, th = RECAP_STORY.TILE, tw = (W - 2 * SIDE - gap) / 2;
  const rows = Math.ceil(tiles.length / 2), h = rows * th + (rows - 1) * gap;
  if (!draw) return h;
  tiles.forEach(([label, value], i) => {
    const x = SIDE + (i % 2) * (tw + gap), ty = y + Math.floor(i / 2) * (th + gap);
    drawCard(ctx, p, x, ty, tw, th);
    ctx.fillStyle = rgbaCss(p.label2); ctx.font = storyFont(600, 30, false, p); setTracking(ctx, 3);
    ctx.fillText(label.toLocaleUpperCase('fr-FR'), x + 36, ty + 66); setTracking(ctx, 0);
    fitSize(ctx, value, tw - 72, 76, 44, s => storyFont(700, s, true, p));
    ctx.fillStyle = rgbaCss(p.label);
    ctx.fillText(value, x + 34, ty + 158);
  });
  return h;
}

// Image complète d'un écran de récap. page : écran (recapPages), st : récap (recapStats),
// palette : couleurs résolues (storyPalette), assets : { icon }.
function drawRecapStory(canvas, page, st, palette, assets = {}) {
  canvas.width = STORY.W; canvas.height = STORY.H;
  const ctx = canvas.getContext('2d'), p = palette;
  const { W, H, TOP, BOTTOM, SIDE, SIGNATURE } = STORY, maxW = W - 2 * SIDE;
  drawBackground(ctx, p);

  // En-tête : « TA SEMAINE » puis la période (sauf sur le résumé, qui la porte en titre)
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  let y = TOP + 40;
  ctx.fillStyle = rgbaCss(p.catText); ctx.font = storyFont(700, RECAP_STORY.KICKER, false, p); setTracking(ctx, 6);
  ctx.fillText(fitText(ctx, page.kicker, maxW), SIDE, y + 32); setTracking(ctx, 0);
  y += 56;
  if (page.id !== 'summary') {
    ctx.fillStyle = rgbaCss(p.label2); ctx.font = storyFont(600, RECAP_STORY.SUB, false, p);
    ctx.fillText(fitText(ctx, st.period.label, maxW), SIDE, y + 32);
    y += 56;
  }
  const headBottom = y + 24, sigY = H - BOTTOM - SIGNATURE;

  // Bloc central mesuré puis centré entre l'en-tête et la signature
  const measure = draw => {
    let h = recapHero(ctx, p, page, 0, false);
    const blocks = [];
    if (page.list)  blocks.push(['rows', page.list, { medal: true }]);
    if (page.tiles) blocks.push(['tiles', page.tiles]);
    if (page.lines?.length) blocks.push(['rows', page.lines.map(([name, value]) => ({ name, value }))]);
    blocks.forEach(b => { h += 48 + (b[0] === 'tiles' ? recapTiles(ctx, p, b[1], 0, false) : recapRows(ctx, p, b[1], 0, false, b[2])); });
    if (!draw) return h;
    let by = headBottom + Math.max(0, (sigY - 40 - headBottom - h) / 2);
    by += recapHero(ctx, p, page, by, true);
    blocks.forEach(b => { by += 48; by += b[0] === 'tiles' ? recapTiles(ctx, p, b[1], by, true) : recapRows(ctx, p, b[1], by, true, b[2]); });
    return h;
  };
  measure(true);
  drawSignature(ctx, p, assets.icon, sigY);
  return canvas;
}

// Image d'un écran de récap dans un canvas, couleurs du thème courant (storyPalette, share.js)
async function renderRecapStory(page, st, canvas = document.createElement('canvas')) {
  const palette = storyPalette(RECAP_KINDS[st.period.kind].color);
  const icon = await loadImage('icon-192.png');
  drawRecapStory(canvas, page, st, palette, { icon });
  return { canvas };
}
