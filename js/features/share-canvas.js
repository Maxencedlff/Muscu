// ═══════════════════════════════════════════════════════════
//  Partage de séance : dessin de l'image (story Instagram)
// ═══════════════════════════════════════════════════════════
'use strict';

// Choix de design (recherche d'octobre 2026) :
// - Format story : 1080 × 1920 (9:16). Instagram couvre le haut (barres de progression, profil,
//   fermer : ~250 px) et le bas (champ de réponse, partage : 250 à 340 px selon les guides ; Meta ne
//   publie pas de chiffre). Tout ce qui compte tient entre STORY.TOP et H − STORY.BOTTOM ; seul le
//   fond déborde.
// - Strava (« Sticker Stats ») et Nike Run Club : trois chiffres énormes, peu de texte, logo discret
//   mais toujours présent. Hevy : records, volume, carte des muscles, fond clair ou sombre.
//   Apple Fitness : chiffres en SF Rounded, couleur d'activité, cartes sombres arrondies.
//   → ici : nom de la séance en très grand, trois tuiles (durée, volume, séries), records en or,
//   3 à 5 exercices clés, signature « MDLF Training » avec l'icône de l'app (publicité à chaque partage).
// - Lisible en vignette (aperçu de story ~ 1/8) : titre ≥ 120 px, chiffres ≥ 76 px, rien sous 28 px.
// - Couleurs : uniquement les tokens de css/base.css, résolus par l'appelant (storyPalette) dans le
//   thème de l'app ; la couleur de la séance colore le halo du fond et le surtitre.
// - Polices système (-apple-system / SF Pro, SF Pro Rounded pour les chiffres). Le canvas n'a pas
//   d'équivalent de font-variant-numeric : les chiffres ne sont jamais alignés en colonne, ils sont
//   ferrés à droite un par ligne.
// Référence : MDN, Canvas API (CanvasRenderingContext2D, Path2D, createRadialGradient, measureText).

const STORY = {
  W: 1080, H: 1920,
  TOP: 250,          // zone d'Instagram en haut (profil, barres de progression)
  BOTTOM: 340,       // zone d'Instagram en bas (champ de réponse) : on prend le chiffre le plus prudent
  SIDE: 80,          // marges latérales
  RADIUS: 44,        // cartes (rayon continu façon iOS, à l'échelle de l'image)
  ROW: 112,          // ligne d'exercice
  CARD_HEAD: 88,     // titre « EXERCICES » de la carte
  CARD_FOOT: 24,
  MORE: 60,          // ligne « + 2 autres exercices »
  TILES: 214,        // tuiles côte à côte (sans silhouette)
  TILES_MAP: 356,    // chiffres en colonne + silhouette
  CHIP: 76,          // pastille des records
  SIGNATURE: 84,     // icône de la signature
};

// Point d'accroche de la silhouette des muscles : share.js y place storyMuscleSvg,
// shareStoryHooks.muscleSvg = (entry, stats, palette) => texte SVG (ou null).
// Sans fournisseur ou sans muscle reconnu, l'image se dessine sans silhouette (mise en page en ligne).
const shareStoryHooks = { muscleSvg: null };

// ── Couleurs (logique pure, testée) ─────────────────────────

// « rgb(255, 159, 10) », « rgba(235, 235, 245, 0.6) », « #FF9F0A » → [r, g, b, a]
function parseCssColor(str) {
  const s = String(str || '').trim();
  let m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (m) {
    const h = m[1].length === 3 ? m[1].replace(/./g, c => c + c) : m[1];
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)).concat(1);
  }
  m = s.match(/^rgba?\(([^)]+)\)$/i);
  if (!m) return null;
  const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
  if (p.length < 3 || p.slice(0, 3).some(isNaN)) return null;
  return [p[0], p[1], p[2], isNaN(p[3]) ? 1 : p[3]];
}

// [r, g, b, a] → « rgba(r, g, b, a) » ; alpha multiplie l'opacité propre de la couleur
function rgbaCss(c, alpha = 1) {
  return `rgba(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])}, ${+(c[3] * alpha).toFixed(3)})`;
}

// Mélange de deux couleurs (pct de a), comme color-mix(in srgb, a pct, b) des feuilles de style
function mixColor(a, b, pct) {
  const k = pct / 100;
  return [0, 1, 2].map(i => a[i] * k + b[i] * (1 - k)).concat(1);
}

// ── Petites aides de dessin ─────────────────────────────────

function storyFont(weight, size, rounded = false, palette) {
  return `${weight} ${size}px ${rounded ? palette.fontRounded : palette.font}`;
}

// Espacement des lettres (CanvasRenderingContext2D.letterSpacing) quand le navigateur le connaît
function setTracking(ctx, px) {
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${px}px`;
}

// Texte tronqué avec « … » pour tenir dans maxW
function fitText(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.slice(0, mid).trimEnd() + '…').width <= maxW) lo = mid; else hi = mid - 1;
  }
  return text.slice(0, lo).trimEnd() + '…';
}

// Taille de police la plus grande (≤ max, ≥ min) qui fait tenir le texte sur maxW
function fitSize(ctx, text, maxW, max, min, fontAt) {
  let size = max;
  ctx.font = fontAt(size);
  while (size > min && ctx.measureText(text).width > maxW) { size -= 4; ctx.font = fontAt(size); }
  return size;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);         ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Carte : fond de cellule du thème, ombre douce en clair, fine bordure en sombre
function drawCard(ctx, p, x, y, w, h) {
  ctx.save();
  roundRect(ctx, x, y, w, h, STORY.RADIUS);
  if (p.light) { ctx.shadowColor = rgbaCss(p.label, .08); ctx.shadowBlur = 40; ctx.shadowOffsetY = 12; }
  ctx.fillStyle = rgbaCss(p.cell, p.light ? 1 : .78);
  ctx.fill();
  ctx.restore();
  if (!p.light) {
    roundRect(ctx, x + 1, y + 1, w - 2, h - 2, STORY.RADIUS - 1);
    ctx.strokeStyle = rgbaCss(p.label, .07); ctx.lineWidth = 2; ctx.stroke();
  }
}

// Médaille de record (mêmes tracés que medalSvg), carrée de côté size
function drawMedal(ctx, p, x, y, size) {
  const k = size / 24;
  ctx.save();
  ctx.translate(x, y); ctx.scale(k, k);
  ctx.fillStyle = rgbaCss(p.gold, .55); ctx.fill(new Path2D(MEDAL_PATHS.ribbon));
  ctx.fillStyle = rgbaCss(p.gold);
  ctx.beginPath(); ctx.arc(12, 15, 6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = rgbaCss(p.cell); ctx.fill(new Path2D(MEDAL_PATHS.star));
  ctx.restore();
}

// Silhouette des muscles (image déjà chargée depuis le SVG du fournisseur), contenue dans le cadre
function drawMuscleMap(ctx, x, y, w, h, image) {
  if (!image?.width) return false;
  const k = Math.min(w / image.width, h / image.height);
  const dw = image.width * k, dh = image.height * k;
  ctx.drawImage(image, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  return true;
}

// ── Blocs de l'image ────────────────────────────────────────

function drawBackground(ctx, p) {
  const { W, H } = STORY;
  ctx.fillStyle = rgbaCss(p.bg); ctx.fillRect(0, 0, W, H);
  // Halo de la couleur de la séance en haut à gauche, rappel plus discret en bas à droite
  const glow = (cx, cy, r, a) => {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, rgbaCss(p.cat, a)); g.addColorStop(1, rgbaCss(p.cat, 0));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  };
  glow(W * .12, 180, 1150, p.light ? .30 : .52);
  glow(W * .95, H * .80, 900, p.light ? .12 : .20);
}

// Surtitre « SAMEDI 17 OCTOBRE · 18:30 » (couleur de la séance), puis le nom de la séance en très grand
function drawHeader(ctx, p, st, y, titleSize) {
  const { SIDE, W } = STORY, maxW = W - 2 * SIDE;
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = rgbaCss(p.catText);
  ctx.font = storyFont(700, 34, false, p); setTracking(ctx, 5);
  const kicker = [st.day, st.time].filter(Boolean).join(' · ').toLocaleUpperCase('fr-FR');
  ctx.fillText(fitText(ctx, kicker, maxW), SIDE, y + 30);
  ctx.fillStyle = rgbaCss(p.label);
  ctx.font = storyFont(800, titleSize, false, p); setTracking(ctx, -titleSize * .02);
  ctx.fillText(fitText(ctx, st.title, maxW), SIDE - 4, y + 52 + titleSize * .9);
  setTracking(ctx, 0);
}

// Pastille dorée « 2 records battus »
function drawRecordsChip(ctx, p, st, y) {
  const text = shareRecordsText(st.records), h = STORY.CHIP, x = STORY.SIDE;
  ctx.font = storyFont(700, 36, false, p);
  roundRect(ctx, x, y, 28 + 48 + 16 + ctx.measureText(text).width + 36, h, h / 2);
  ctx.fillStyle = rgbaCss(p.gold, p.light ? .16 : .18); ctx.fill();
  drawMedal(ctx, p, x + 26, y + 14, 48);
  ctx.fillStyle = rgbaCss(p.goldText); ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 28 + 48 + 16, y + h / 2 + 2);
  ctx.textBaseline = 'alphabetic';
}

function storyTiles(st) {
  return [['Durée', st.duration || '—'], ['Volume', st.volume || '—'], ['Séries', String(st.sets)]];
}

// Libellé en petites capitales espacées, valeur en SF Rounded (taille ajustée à la largeur)
function drawStat(ctx, p, label, value, x, y, maxW, size, gap) {
  ctx.fillStyle = rgbaCss(p.label2); ctx.font = storyFont(600, 30, false, p); setTracking(ctx, 3);
  ctx.fillText(label.toLocaleUpperCase('fr-FR'), x, y + 30); setTracking(ctx, 0);
  fitSize(ctx, value, maxW, size, 48, s => storyFont(700, s, true, p));
  ctx.fillStyle = rgbaCss(p.label);
  ctx.fillText(value, x - 2, y + 30 + gap);
}

// Trois tuiles côte à côte (sans silhouette)
function drawTilesRow(ctx, p, st, y) {
  const { SIDE, W, TILES: h } = STORY, gap = 24;
  const w = (W - 2 * SIDE - 2 * gap) / 3;
  storyTiles(st).forEach(([label, value], i) => {
    const x = SIDE + i * (w + gap);
    drawCard(ctx, p, x, y, w, h);
    drawStat(ctx, p, label, value, x + 36, y + 36, w - 64, 80, 104);
  });
}

// Chiffres en tableau à gauche (libellé, valeur ferrée à droite), silhouette des muscles à droite
function drawTilesWithMap(ctx, p, st, y, image) {
  const { SIDE, W, TILES_MAP: h } = STORY, colW = 440, padX = 44, step = 92;
  drawCard(ctx, p, SIDE, y, W - 2 * SIDE, h);
  const left = SIDE + padX, right = SIDE + colW;
  storyTiles(st).forEach(([label, value], i) => {
    const base = y + 40 + i * step + 62;
    if (i) { ctx.fillStyle = rgbaCss(p.sep); ctx.fillRect(left, y + 40 + i * step, right - left, 2); }
    ctx.fillStyle = rgbaCss(p.label2); ctx.font = storyFont(600, 30, false, p); setTracking(ctx, 3);
    ctx.fillText(label.toLocaleUpperCase('fr-FR'), left, base); setTracking(ctx, 0);
    fitSize(ctx, value, colW - padX - 190, 58, 40, s => storyFont(700, s, true, p));
    ctx.fillStyle = rgbaCss(p.label); ctx.textAlign = 'right';
    ctx.fillText(value, right, base); ctx.textAlign = 'left';
  });
  drawMuscleMap(ctx, right + 24, y + 28, W - SIDE - right - 24 - 28, h - 56, image);
}

function highlightsHeight(rows, more) {
  return rows ? STORY.CARD_HEAD + rows * STORY.ROW + (more ? STORY.MORE : 0) + STORY.CARD_FOOT : 0;
}

// Carte des exercices clés : nom et « Meilleure série » (ou record, en or), valeur ferrée à droite
function drawHighlights(ctx, p, st, y, rows, more) {
  const { SIDE, W, ROW, CARD_HEAD } = STORY, w = W - 2 * SIDE, padX = 44;
  const list = st.highlights.slice(0, rows);
  drawCard(ctx, p, SIDE, y, w, highlightsHeight(rows, more));
  ctx.fillStyle = rgbaCss(p.label2); ctx.font = storyFont(600, 30, false, p); setTracking(ctx, 3);
  ctx.fillText('EXERCICES', SIDE + padX, y + 68); setTracking(ctx, 0);

  list.forEach((r, i) => {
    const ry = y + CARD_HEAD + i * ROW;
    if (i) { ctx.fillStyle = rgbaCss(p.sep); ctx.fillRect(SIDE + padX, ry, w - 2 * padX, 2); }
    ctx.font = storyFont(700, 46, true, p);
    const vw = ctx.measureText(r.value).width;
    ctx.fillStyle = rgbaCss(r.record ? p.goldText : p.label);
    ctx.textAlign = 'right'; ctx.fillText(r.value, SIDE + w - padX, ry + 72); ctx.textAlign = 'left';

    const nameW = w - 2 * padX - vw - 32;
    ctx.font = storyFont(600, 40, false, p); ctx.fillStyle = rgbaCss(p.label);
    ctx.fillText(fitText(ctx, r.name, nameW), SIDE + padX, ry + 50);
    ctx.font = storyFont(500, 30, false, p);
    if (r.record) {
      drawMedal(ctx, p, SIDE + padX - 4, ry + 65, 36);
      ctx.fillStyle = rgbaCss(p.goldText);
      ctx.fillText(fitText(ctx, r.record, nameW - 40), SIDE + padX + 38, ry + 93);
    } else {
      ctx.fillStyle = rgbaCss(p.label2);
      ctx.fillText('Meilleure série', SIDE + padX, ry + 93);
    }
  });
  if (more) {
    const hidden = st.highlights.length + st.others - list.length;
    ctx.fillStyle = rgbaCss(p.label2); ctx.font = storyFont(500, 30, false, p);
    ctx.fillText(`+ ${plural(hidden, 'autre exercice', 'autres exercices')}`, SIDE + padX, y + CARD_HEAD + rows * ROW + 42);
  }
}

// Signature publicitaire : icône de l'app + « MDLF Training », centrée
function drawSignature(ctx, p, icon, y) {
  const size = STORY.SIGNATURE, gap = 24, cy = y + size / 2;
  ctx.font = storyFont(800, 46, false, p);
  const nameW = ctx.measureText('MDLF Training').width;
  ctx.font = storyFont(500, 28, false, p);
  const subW = ctx.measureText('Carnet de musculation').width;
  const x = (STORY.W - (size + gap + Math.max(nameW, subW))) / 2;

  roundRect(ctx, x, y, size, size, size * .225);   // masque d'icône iOS (≈ 22,5 % du côté)
  if (icon?.width) { ctx.save(); ctx.clip(); ctx.drawImage(icon, x, y, size, size); ctx.restore(); }
  else { ctx.fillStyle = rgbaCss(p.cat); ctx.fill(); }
  ctx.textAlign = 'left';
  ctx.fillStyle = rgbaCss(p.label); ctx.font = storyFont(800, 46, false, p); setTracking(ctx, -.5);
  ctx.fillText('MDLF Training', x + size + gap, cy - 2); setTracking(ctx, 0);
  ctx.fillStyle = rgbaCss(p.label2); ctx.font = storyFont(500, 28, false, p);
  ctx.fillText('Carnet de musculation', x + size + gap, cy + 36);
}

// ── Mise en page ────────────────────────────────────────────

// Hauteurs de chaque bloc, nombre d'exercices qui tiennent, puis bloc entier centré dans la zone
// sûre : l'image reste équilibrée qu'elle ait 1 ou 12 exercices, avec ou sans silhouette.
function storyLayout(ctx, p, st, hasMap) {
  const { W, H, TOP, BOTTOM, SIDE, ROW } = STORY;
  const titleSize = fitSize(ctx, st.title, W - 2 * SIDE, 150, 96, s => storyFont(800, s, false, p));
  const blocks = [
    ['header', 52 + titleSize * 1.1, 36],
    st.records ? ['chip', STORY.CHIP, 28] : null,
    ['tiles', hasMap ? STORY.TILES_MAP : STORY.TILES, 32],
    ['highlights', 0, 48],
    ['signature', STORY.SIGNATURE, 0],
  ].filter(Boolean);
  const safe  = H - TOP - BOTTOM;
  const fixed = blocks.reduce((a, [, h, gap]) => a + h + gap, 0);
  const room  = safe - fixed - STORY.CARD_HEAD - STORY.CARD_FOOT;
  let rows = Math.max(0, Math.min(st.highlights.length, Math.floor(room / ROW)));
  if (rows === 0) blocks.find(b => b[0] === 'highlights')[2] = 0;   // pas de carte : pas d'écart
  const hidden = st.highlights.length + st.others - rows;
  const more = rows > 0 && hidden > 0 && room - rows * ROW >= STORY.MORE;
  blocks.find(b => b[0] === 'highlights')[1] = highlightsHeight(rows, more);

  const total = blocks.reduce((a, [, h, gap]) => a + h + gap, 0);
  let y = TOP + Math.max(0, (safe - total) / 2);
  const at = {};
  blocks.forEach(([name, h, gap]) => { at[name] = y; y += h + gap; });
  return { at, titleSize, rows, more };
}

// ── Image complète ──────────────────────────────────────────

// Dessine la story dans le canvas (redimensionné à 1080 × 1920).
// palette : couleurs résolues ([r, g, b, a]) et polices ; assets : { icon, muscle } (images chargées).
function drawStory(canvas, st, palette, assets = {}) {
  canvas.width = STORY.W; canvas.height = STORY.H;
  const ctx = canvas.getContext('2d'), p = palette;
  const hasMap = !!assets.muscle?.width;
  const { at, titleSize, rows, more } = storyLayout(ctx, p, st, hasMap);
  drawBackground(ctx, p);
  drawHeader(ctx, p, st, at.header, titleSize);
  if (st.records) drawRecordsChip(ctx, p, st, at.chip);
  if (hasMap) drawTilesWithMap(ctx, p, st, at.tiles, assets.muscle);
  else drawTilesRow(ctx, p, st, at.tiles);
  if (rows) drawHighlights(ctx, p, st, at.highlights, rows, more);
  drawSignature(ctx, p, assets.icon, at.signature);
  return canvas;
}
