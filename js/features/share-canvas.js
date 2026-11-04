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
  CARD_HEAD_TIGHT: 64,   // séance avec supersets très chargée (air = 0) : titre et pied de carte resserrés
  CARD_FOOT_TIGHT: 16,
  MORE: 60,          // ligne « + 2 autres exercices »
  ROW_COMPACT: 64,   // ligne d'exercice sur une seule ligne (nom à gauche, série à droite), quand il y en a beaucoup
  ROW_MIN: 44,       // en dessous, la police deviendrait illisible : les derniers passent dans « + N autres »
  ROW_MIN_SS: 50,    // avec des supersets : lignes de 50 px au plus serré (nom de 30 px)
  NAME_MIN: 30,      // avec des supersets : nom jamais plus petit (tronqué au-delà)
  DETAIL_MIN: 22,    // détail des séries d'un superset (« 30 kg × 10 · 10 · 9 »)
  TILES: 214,        // tuiles côte à côte (sans silhouette)
  TILES_MAP: 356,    // chiffres en colonne + silhouette
  CHIP: 76,          // pastille des records
  SIGNATURE: 84,     // icône de la signature
};

// Point d'accroche de la carte des muscles : share.js y place storyMuscleMap,
// shareStoryHooks.muscleMap = (entry, stats, palette) => { levels, colors } (ou null), dessinée par
// bodyMapImage (js/ui/body-map.js). Sans fournisseur ou sans muscle reconnu, l'image se dessine sans
// personnage (mise en page en ligne).
const shareStoryHooks = { muscleMap: null };

// Compte Instagram de l'app, sous le nom dans la signature (« @mdlftraining », créé le 01/11/2026) ;
// vide, la signature garde « Suivi de musculation »
const STORY_INSTAGRAM = 'mdlftraining';

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

// Médaille de record (mêmes tracés que medalSvg, js/ui/medal.js), carrée de côté size
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

// Carte des muscles (canvas déjà dessiné par bodyMapImage), contenue dans le cadre
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
// h : hauteur (STORY.CHIP ; plus serrée quand une séance avec supersets manque de place)
function drawRecordsChip(ctx, p, st, y, h = STORY.CHIP) {
  const text = shareRecordsText(st.records), x = STORY.SIDE, k = h / STORY.CHIP;
  const medal = Math.round(48 * k), pad = Math.round(28 * k);
  ctx.font = storyFont(700, Math.max(28, Math.round(36 * Math.min(1, k * 1.1))), false, p);   // rien sous 28 px
  roundRect(ctx, x, y, pad + medal + 16 + ctx.measureText(text).width + 36, h, h / 2);
  ctx.fillStyle = rgbaCss(p.gold, p.light ? .16 : .18); ctx.fill();
  drawMedal(ctx, p, x + pad - 2, y + (h - medal) / 2, medal);
  ctx.fillStyle = rgbaCss(p.goldText); ctx.textBaseline = 'middle';
  ctx.fillText(text, x + pad + medal + 16, y + h / 2 + 2);
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

// Trois tuiles côte à côte (sans silhouette). h : hauteur (STORY.TILES ; moins hautes quand une
// séance avec supersets manque de place, chiffres réduits d'autant)
function drawTilesRow(ctx, p, st, y, h = STORY.TILES) {
  const { SIDE, W } = STORY, gap = 24, k = h / STORY.TILES;
  const w = (W - 2 * SIDE - 2 * gap) / 3;
  storyTiles(st).forEach(([label, value], i) => {
    const x = SIDE + i * (w + gap);
    drawCard(ctx, p, x, y, w, h);
    drawStat(ctx, p, label, value, x + 36, y + Math.round(36 * k), w - 64, Math.round(80 * Math.min(1, k * 1.1)), Math.round(104 * k));
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

// Mesures d'un bloc de superset selon la hauteur de ligne : pleine (ROW) ou compacte.
// Petit titre (« SUPERSET »), de l'air, puis chaque exercice sur deux lignes : le nom, à la taille des
// lignes hors superset, et le détail des séries (75 % du nom, jamais sous DETAIL_MIN), en retrait
// derrière le crochet. air (1 → 0,5) : espacements réduits quand la séance manque de place.
function groupMetrics(rowH, air = 1) {
  const full = rowH >= STORY.ROW;
  const name = full ? 40 : Math.round(Math.min(40, rowH * 0.6));
  const detail = Math.max(STORY.DETAIL_MIN, Math.round(name * 0.75));
  const title = full ? 26 : Math.max(22, Math.round(name * 0.65));
  const titleBase = Math.round(12 + 6 * air) + Math.round(title * 0.75);  // air sous la ligne de séparation
  // air (1 → 0) : 0 seulement dans une séance très chargée, la carte se resserre aussi (CARD_HEAD_TIGHT)
  const nameBase = Math.round(name * 0.92), detailBase = nameBase + Math.round(detail * 1.3);
  return {
    name, nameMin: full ? 32 : Math.max(STORY.NAME_MIN, name - 8), detail, title, titleBase,
    head: titleBase + Math.round(8 + 10 * air),                           // air entre le titre et le premier exercice
    nameBase, detailBase,
    member: detailBase + Math.round(detail * 0.25) + Math.round(6 + 8 * air),   // air entre deux exercices
    foot: 6, indent: 40,
  };
}

// Exercice seul avec le détail de ses séries : marge du haut (pas de titre « SUPERSET »)
function soloPad(air = 1) { return Math.round(10 + 6 * air); }

// Hauteur d'un bloc de la liste : exercice seul avec ses séries (nom + détail), titre + deux lignes
// par exercice pour un superset ; exercice sans détail (ancienne ligne) : une ligne
function unitHeight(u, rowH, air = 1) {
  const g = groupMetrics(rowH, air);
  if (u[0].group == null) return u[0].sets ? soloPad(air) + g.member : rowH;
  return g.head + u.length * g.member + g.foot;
}

// Exercice seul : le nom, puis le détail de toutes ses séries (en or s'il y a un record), comme un
// exercice de superset mais sans crochet ni titre
function drawSolo(ctx, p, r, ry, rowH, nameSize = null, air = 1) {
  const { SIDE, W } = STORY, padX = 44, g = groupMetrics(rowH, air), pad = soloPad(air);
  const x = SIDE + padX, maxW = W - 2 * SIDE - 2 * padX;
  if (nameSize) ctx.font = storyFont(600, nameSize, false, p);
  else fitSize(ctx, r.name, maxW, g.name, g.nameMin, s => storyFont(600, s, false, p));
  ctx.fillStyle = rgbaCss(p.label);
  ctx.fillText(fitText(ctx, r.name, maxW), x, ry + pad + g.nameBase);
  fitSize(ctx, r.sets, maxW, g.detail + 4, Math.max(STORY.DETAIL_MIN, g.detail - 4), s => storyFont(700, s, true, p));
  ctx.fillStyle = rgbaCss(r.record ? p.goldText : p.label2);
  ctx.fillText(fitText(ctx, r.sets, maxW), x, ry + pad + g.detailBase + 4);
}

// list : exercices montrés (st.highlights, début de la liste coupé entre deux blocs)
function highlightsHeight(list, more, rowH = STORY.ROW, air = 1) {
  const units = shareUnits(list);
  if (!units.length) return 0;
  const head = air > 0 ? STORY.CARD_HEAD : STORY.CARD_HEAD_TIGHT, foot = air > 0 ? STORY.CARD_FOOT : STORY.CARD_FOOT_TIGHT;
  return head + units.reduce((a, u) => a + unitHeight(u, rowH, air), 0) + (more ? STORY.MORE : 0) + foot;
}

// Superset : « SUPERSET » en couleur de la séance, crochet « [ » qui tient ses exercices, puis pour
// chacun le nom et le détail de toutes ses séries (« 30 kg × 10 · 10 · 9 », en or s'il y a un record).
// nameSize : taille commune des noms en lignes compactes (sinon réduite exercice par exercice).
function drawGroup(ctx, p, u, ry, rowH, nameSize = null, air = 1) {
  const { SIDE, W } = STORY, padX = 44, g = groupMetrics(rowH, air);
  const x = SIDE + padX, tx = x + g.indent, maxW = W - 2 * SIDE - 2 * padX - g.indent;
  ctx.fillStyle = rgbaCss(p.catText); ctx.font = storyFont(700, g.title, false, p); setTracking(ctx, 3);
  ctx.fillText(u[0].kind.toLocaleUpperCase('fr-FR'), x, ry + g.titleBase); setTracking(ctx, 0);

  // Crochet « [ » : du haut du premier nom au bas du dernier détail, avec ses retours en haut et en bas
  const top = ry + g.head + g.nameBase - g.name * 0.8;
  const bottom = ry + g.head + (u.length - 1) * g.member + g.detailBase + g.detail * 0.25;
  const lw = 6, bx = x + lw / 2, tick = 18;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(bx + tick, top); ctx.lineTo(bx, top); ctx.lineTo(bx, bottom); ctx.lineTo(bx + tick, bottom);
  ctx.strokeStyle = rgbaCss(p.cat); ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.stroke();
  ctx.restore();

  u.forEach((r, i) => {
    const my = ry + g.head + i * g.member;
    if (nameSize) ctx.font = storyFont(600, nameSize, false, p);
    else fitSize(ctx, r.name, maxW, g.name, g.nameMin, s => storyFont(600, s, false, p));
    ctx.fillStyle = rgbaCss(p.label);
    ctx.fillText(fitText(ctx, r.name, maxW), tx, my + g.nameBase);
    fitSize(ctx, r.sets, maxW, g.detail, Math.max(STORY.DETAIL_MIN, g.detail - 4), s => storyFont(600, s, true, p));
    ctx.fillStyle = rgbaCss(r.record ? p.goldText : p.label2);
    ctx.fillText(fitText(ctx, r.sets, maxW), tx, my + g.detailBase);
  });
}

// Carte des exercices clés : nom et « Meilleure série » (ou record, en or), valeur ferrée à droite ;
// un superset forme un bloc (drawGroup).
// rowH < ROW : lignes compactes, nom et série sur une seule ligne, police proportionnée à la hauteur
function drawHighlights(ctx, p, st, y, rows, more, rowH = STORY.ROW, air = 1) {
  const { SIDE, W, ROW } = STORY, w = W - 2 * SIDE, padX = 44;
  const CARD_HEAD = air > 0 ? STORY.CARD_HEAD : STORY.CARD_HEAD_TIGHT;
  const list = st.highlights.slice(0, rows);
  // Avec des supersets, un nom n'est jamais réduit sous NAME_MIN (il est tronqué au-delà)
  const nameFloor = list.some(r => r.group != null || r.sets) ? STORY.NAME_MIN : 24;
  drawCard(ctx, p, SIDE, y, w, highlightsHeight(list, more, rowH, air));
  ctx.fillStyle = rgbaCss(p.label2); ctx.font = storyFont(600, 30, false, p); setTracking(ctx, 3);
  ctx.fillText('EXERCICES', SIDE + padX, y + CARD_HEAD - 20); setTracking(ctx, 0);

  const compact = rowH < ROW;
  const size = Math.round(Math.min(40, rowH * 0.6)), base = Math.round(rowH * 0.66);
  // Lignes compactes : une seule taille pour tous les noms (la plus petite nécessaire), la liste se lit d'un bloc
  const nameSize = compact ? Math.min(...list.map(r => {
    if (r.group != null || r.sets) {
      const indent = r.group != null ? groupMetrics(rowH, air).indent : 0;
      return fitSize(ctx, r.name, w - 2 * padX - indent, size, Math.max(nameFloor, size - 8), s2 => storyFont(600, s2, false, p));
    }
    ctx.font = storyFont(700, size, true, p);
    const nameW = w - 2 * padX - ctx.measureText(r.value).width - 28;
    return fitSize(ctx, r.name, nameW, size, Math.max(nameFloor, size - 8), s2 => storyFont(600, s2, false, p));
  })) : null;

  let ry = y + CARD_HEAD;
  shareUnits(list).forEach((u, i) => {
    if (i) { ctx.fillStyle = rgbaCss(p.sep); ctx.fillRect(SIDE + padX, ry, w - 2 * padX, 2); }
    const r = u[0];
    if (r.group != null) drawGroup(ctx, p, u, ry, rowH, nameSize, air);
    else if (r.sets) drawSolo(ctx, p, r, ry, rowH, nameSize, air);
    else if (compact) {
      const valMax = w - 2 * padX - 140;
      fitSize(ctx, r.value, valMax, size, Math.max(22, size - 14), s2 => storyFont(700, s2, true, p));
      const vw = Math.min(ctx.measureText(r.value).width, valMax);
      ctx.fillStyle = rgbaCss(r.record ? p.goldText : p.label);
      ctx.textAlign = 'right'; ctx.fillText(fitText(ctx, r.value, valMax), SIDE + w - padX, ry + base); ctx.textAlign = 'left';
      const nameW = w - 2 * padX - vw - 28;
      ctx.font = storyFont(600, nameSize, false, p);
      ctx.fillStyle = rgbaCss(p.label);
      ctx.fillText(fitText(ctx, r.name, nameW), SIDE + padX, ry + base);
    } else {
      // La valeur peut être le détail de toutes les séries (« 6 · 6 · 6 · 7 reps ») : elle rétrécit
      // puis se tronque, sinon elle déborderait de la carte et écraserait le nom de l'exercice
      const valMax = w - 2 * padX - 170;
      fitSize(ctx, r.value, valMax, 46, 26, s2 => storyFont(700, s2, true, p));
      const vw = Math.min(ctx.measureText(r.value).width, valMax);
      ctx.fillStyle = rgbaCss(r.record ? p.goldText : p.label);
      ctx.textAlign = 'right'; ctx.fillText(fitText(ctx, r.value, valMax), SIDE + w - padX, ry + 72); ctx.textAlign = 'left';

      // Le nom est l'information principale : la police est réduite (40 → 32 px) avant de tronquer
      const nameW = w - 2 * padX - vw - 32;
      fitSize(ctx, r.name, nameW, 40, 32, s => storyFont(600, s, false, p));
      ctx.fillStyle = rgbaCss(p.label);
      ctx.fillText(fitText(ctx, r.name, nameW), SIDE + padX, ry + 50);
      ctx.font = storyFont(500, 30, false, p);
      if (r.record) {
        drawMedal(ctx, p, SIDE + padX - 4, ry + 65, 36);
        ctx.fillStyle = rgbaCss(p.goldText);
        ctx.fillText(fitText(ctx, r.record, nameW - 40), SIDE + padX + 38, ry + 93);
      } else {
        ctx.fillStyle = rgbaCss(p.label2);
        ctx.fillText(r.detail ? 'Séries' : 'Meilleure série', SIDE + padX, ry + 93);
      }
    }
    ry += unitHeight(u, rowH, air);
  });
  if (more) {
    const hidden = st.highlights.length + st.others - list.length;
    ctx.fillStyle = rgbaCss(p.label2); ctx.font = storyFont(500, 30, false, p);
    ctx.fillText(`+ ${plural(hidden, 'autre exercice', 'autres exercices')}`, SIDE + padX, ry + 42);
  }
}

// Signature publicitaire : icône de l'app + « MDLF Training », centrée
function drawSignature(ctx, p, icon, y) {
  const size = STORY.SIGNATURE, gap = 24, cy = y + size / 2;
  ctx.font = storyFont(800, 46, false, p);
  const nameW = ctx.measureText('MDLF Training').width;
  const sub = STORY_INSTAGRAM ? `@${STORY_INSTAGRAM.replace(/^@/, '')}` : 'Suivi de musculation';
  ctx.font = storyFont(500, 28, false, p);
  const subW = ctx.measureText(sub).width;
  const x = (STORY.W - (size + gap + Math.max(nameW, subW))) / 2;

  roundRect(ctx, x, y, size, size, size * .225);   // masque d'icône iOS (≈ 22,5 % du côté)
  if (icon?.width) { ctx.save(); ctx.clip(); ctx.drawImage(icon, x, y, size, size); ctx.restore(); }
  else { ctx.fillStyle = rgbaCss(p.cat); ctx.fill(); }
  ctx.textAlign = 'left';
  ctx.fillStyle = rgbaCss(p.label); ctx.font = storyFont(800, 46, false, p); setTracking(ctx, -.5);
  ctx.fillText('MDLF Training', x + size + gap, cy - 2); setTracking(ctx, 0);
  ctx.fillStyle = rgbaCss(p.label2); ctx.font = storyFont(500, 28, false, p);
  ctx.fillText(sub, x + size + gap, cy + 36);
}

// ── Mise en page ────────────────────────────────────────────

// Hauteurs de chaque bloc et place des exercices, puis bloc entier centré dans la zone sûre.
// Tous les exercices doivent figurer : lignes complètes si elles tiennent, sinon lignes compactes,
// sinon la silhouette laisse sa place aux chiffres en ligne, sinon lignes resserrées (ROW_MIN) ;
// seulement au-delà, les derniers passent dans « + N autres exercices ».
function storyLayout(ctx, p, st, hasMap) {
  const units = shareUnits(st.highlights);
  // Détail des séries ou supersets : blocs de hauteur variable, mise en page qui garde tout le détail
  if (units.some(u => u[0].group != null || u[0].sets)) return storyLayoutGrouped(ctx, p, st, hasMap, units);
  const { W, H, TOP, BOTTOM, SIDE, ROW, ROW_COMPACT, ROW_MIN } = STORY;
  const titleSize = fitSize(ctx, st.title, W - 2 * SIDE, 150, 96, s => storyFont(800, s, false, p));
  const n = st.highlights.length;
  const plan = map => {
    const blocks = [
      ['header', 52 + titleSize * 1.1, 36],
      st.records ? ['chip', STORY.CHIP, 28] : null,
      ['tiles', map ? STORY.TILES_MAP : STORY.TILES, 32],
      ['highlights', 0, 48],
      ['signature', STORY.SIGNATURE, 0],
    ].filter(Boolean);
    const room = H - TOP - BOTTOM - blocks.reduce((a, [, h, gap]) => a + h + gap, 0) - STORY.CARD_HEAD - STORY.CARD_FOOT;
    return { blocks, room, map };
  };
  // Premier essai qui montre tout, dans l'ordre de préférence
  const tries = [[hasMap, ROW], [hasMap, ROW_COMPACT], [false, ROW_COMPACT]];
  let chosen = null;
  for (const [map, rowH] of tries) {
    if (map !== hasMap && map) continue;
    const pl = plan(map);
    if (n * rowH <= pl.room) { chosen = { ...pl, rowH, rows: n }; break; }
  }
  if (!chosen) {
    const pl = plan(false);
    const rowH = Math.max(ROW_MIN, Math.min(ROW_COMPACT, Math.floor(pl.room / Math.max(1, n))));
    chosen = { ...pl, rowH, rows: Math.max(0, Math.min(n, Math.floor(pl.room / rowH))) };
  }
  const { blocks, room, rowH } = chosen;
  let rows = chosen.rows;
  if (rows === 0) blocks.find(b => b[0] === 'highlights')[2] = 0;   // pas de carte : pas d'écart
  let hidden = n + st.others - rows;
  // La ligne « + N autres » doit tenir : on retire une ligne d'exercice si besoin
  if (rows > 0 && hidden > 0 && room - rows * rowH < STORY.MORE) { rows--; hidden++; }
  const more = rows > 0 && hidden > 0;
  blocks.find(b => b[0] === 'highlights')[1] = highlightsHeight(st.highlights.slice(0, rows), more, rowH);

  const total = blocks.reduce((a, [, h, gap]) => a + h + gap, 0);
  let y = TOP + Math.max(0, (H - TOP - BOTTOM - total) / 2);
  const at = {};
  blocks.forEach(([name, h, gap]) => { at[name] = y; y += h + gap; });
  return { at, titleSize, rows, more, rowH, map: chosen.map, list: st.highlights.slice(0, rows), blocks };
}

// Séance avec supersets : tous les exercices et tout le détail de chaque bloc, entre TOP (barre de
// profil d'Instagram) et BOTTOM (zone de réponse), signature comprise. On part de la mise en page aérée
// et on ne récupère de la place que s'il le faut, dans cet ordre : silhouette retirée, en-tête plus
// compact (titre, pastille des records, tuiles), espacements réduits, puis texte réduit jusqu'aux
// minimums lisibles (lignes de ROW_MIN_SS, nom de NAME_MIN, détail de DETAIL_MIN). En dernier recours
// seulement (séance énorme), les derniers exercices hors superset passent dans « + N autres » ;
// un bloc montré l'est toujours en entier.
const STORY_SS_AIRY  = { titleMax: 150, headerGap: 36, chipH: 76, chipGap: 28, tilesH: 214, tilesGap: 32, cardGap: 48, air: 1 };
const STORY_SS_TIGHT = { titleMax: 116, headerGap: 24, chipH: 60, chipGap: 18, tilesH: 168, tilesGap: 22, cardGap: 32 };
const STORY_SS_ULTRA = { titleMax: 96, headerGap: 16, chipH: 52, chipGap: 12, tilesH: 140, tilesGap: 16, cardGap: 24 };

// Mises en page essayées dans l'ordre, de la plus aérée à la plus serrée : silhouette, lignes complètes
// puis compactes ; en-tête compact ; espacements réduits ; texte réduit (rowH : nom à 60 %)
function storySsPresets(hasMap) {
  const { ROW, ROW_COMPACT, ROW_MIN_SS } = STORY;
  const airy = STORY_SS_AIRY, ultra = { ...airy, ...STORY_SS_ULTRA, map: false };
  const tightMap = { ...airy, ...STORY_SS_TIGHT, map: hasMap };
  const out = [
    { ...airy, map: hasMap, rowH: ROW },
    { ...airy, map: hasMap, rowH: ROW_COMPACT },
    // La silhouette reste tant qu'un en-tête plus compact suffit à la garder
    { ...tightMap, rowH: ROW },
    { ...tightMap, rowH: ROW, air: 0.5 },
    { ...tightMap, rowH: ROW_COMPACT, air: 0.5 },
    { ...airy, map: false, rowH: ROW },
    { ...airy, map: false, rowH: ROW_COMPACT },
    { ...airy, ...STORY_SS_TIGHT, map: false, rowH: ROW_COMPACT },
    { ...ultra, rowH: ROW_COMPACT },
    { ...ultra, rowH: ROW_COMPACT, air: 0.5 },
    { ...ultra, rowH: ROW_COMPACT, air: 0 },
  ];
  for (let rowH = ROW_COMPACT - 2; rowH >= ROW_MIN_SS; rowH -= 2) out.push({ ...ultra, rowH, air: 0 });
  return out.filter(pr => !pr.map || hasMap);
}

function storyLayoutGrouped(ctx, p, st, hasMap, units) {
  const { W, H, TOP, BOTTOM, SIDE } = STORY, avail = H - TOP - BOTTOM;
  const measure = (pr, list, more) => {
    const titleSize = fitSize(ctx, st.title, W - 2 * SIDE, pr.titleMax, 96, s => storyFont(800, s, false, p));
    const card = highlightsHeight(list, more, pr.rowH, pr.air);
    const blocks = [
      ['header', 52 + titleSize * 1.1, pr.headerGap],
      st.records ? ['chip', pr.chipH, pr.chipGap] : null,
      ['tiles', pr.map ? STORY.TILES_MAP : pr.tilesH, pr.tilesGap],
      ['highlights', card, card ? pr.cardGap : 0],
      ['signature', STORY.SIGNATURE, 0],
    ].filter(Boolean);
    return { pr, list, more, titleSize, blocks, total: blocks.reduce((a, [, h, gap]) => a + h + gap, 0) };
  };
  const presets = storySsPresets(hasMap);
  const all = st.highlights, moreAll = st.others > 0;
  let chosen = presets.map(pr => measure(pr, all, moreAll)).find(m => m.total <= avail);
  if (!chosen) {
    // Séance énorme : les exercices hors superset les plus loin dans la séance passent dans « + N autres »,
    // puis (s'il n'y a plus que des blocs) les derniers blocs
    const pr = presets.at(-1);
    let us = [...units];
    while (us.length) {
      const k = us.findLastIndex(u => u[0].group == null);
      us.splice(k >= 0 ? k : us.length - 1, 1);
      const m = measure(pr, us.flat(), true);
      if (m.total <= avail) { chosen = m; break; }
    }
    chosen ||= measure(pr, [], true);
  }
  const { pr, list, blocks, total, titleSize } = chosen;
  const more = list.length > 0 && list.length < all.length + st.others;
  let y = TOP + Math.max(0, (avail - total) / 2);
  const at = {};
  blocks.forEach(([name, h, gap]) => { at[name] = y; y += h + gap; });
  return { at, titleSize, rows: list.length, more, rowH: pr.rowH, map: pr.map, list, air: pr.air,
           chipH: pr.chipH, tilesH: pr.tilesH, blocks };
}

// ── Image complète ──────────────────────────────────────────

// Dessine la story dans le canvas (redimensionné à 1080 × 1920).
// palette : couleurs résolues ([r, g, b, a]) et polices ; assets : { icon, muscle } (images chargées).
function drawStory(canvas, st, palette, assets = {}) {
  canvas.width = STORY.W; canvas.height = STORY.H;
  const ctx = canvas.getContext('2d'), p = palette;
  const { at, titleSize, rows, more, rowH, map, list, air = 1, chipH, tilesH } = storyLayout(ctx, p, st, !!assets.muscle?.width);
  // Exercices montrés (avec des supersets, pas forcément les premiers) ; les autres vont dans « + N autres »
  const shown = { ...st, highlights: list, others: st.others + st.highlights.length - list.length };
  drawBackground(ctx, p);
  drawHeader(ctx, p, st, at.header, titleSize);
  if (st.records) drawRecordsChip(ctx, p, st, at.chip, chipH);
  if (map) drawTilesWithMap(ctx, p, st, at.tiles, assets.muscle);
  else drawTilesRow(ctx, p, st, at.tiles, tilesH);
  if (rows) drawHighlights(ctx, p, shown, at.highlights, rows, more, rowH, air);
  drawSignature(ctx, p, assets.icon, at.signature);
  return canvas;
}
