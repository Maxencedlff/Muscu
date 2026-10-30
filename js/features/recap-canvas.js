// ═══════════════════════════════════════════════════════════
//  Récaps : dessin de l'image story (1080 × 1920) d'un écran
// ═══════════════════════════════════════════════════════════
'use strict';

// Même mise en page que l'écran (js/features/recap.js) : aplat de la couleur de l'écran (citron vert,
// violet, orange, rose : css/recap.css), chiffre géant, puis les blocs de l'écran (tuiles, avant → après,
// courbe, frise, personnage…), et la signature « MDLF Training » au même endroit sur toutes les stories :
// c'est elle qui fait connaître l'app à chaque partage. Un aplat saturé plutôt qu'un fond noir : la story
// ressort dans le fil d'Instagram. Zones d'Instagram (STORY.TOP, STORY.BOTTOM, share-canvas.js) laissées
// vides ; rien sous 36 px (lisible en vignette). Jamais de poids du corps ni de mensuration dans l'image.
const RECAP_TONE_COLORS = {
  lime:   { bg: '#C8F53C', fg: '#000000', heat: '#5B3BF0', box: '#000000', boxText: '#FFFFFF' },
  violet: { bg: '#5B3BF0', fg: '#FFFFFF', heat: '#C8F53C', box: '#FFFFFF', boxText: '#000000' },
  orange: { bg: '#FF7A3D', fg: '#000000', heat: '#5B3BF0', box: '#000000', boxText: '#FFFFFF' },
  pink:   { bg: '#FF6FA5', fg: '#000000', heat: '#5B3BF0', box: '#000000', boxText: '#FFFFFF' },
};
const RECAP_STORY = {
  HEAD: 40,          // « MA SEMAINE · 12 – 18 OCTOBRE »
  NUM_MAX: 300, NUM_MIN: 140,
  TITLE_MAX: 132, TITLE_MIN: 76,
  CAPTION: 58, NOTE: 42, TEXT: 42, SMALL: 36,
  GAP: 28,
  TILE: 196,
  SIG: 96,           // icône de la signature
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

// Plus grande taille (de max à min) où le texte tient en maxLines lignes
function recapFitLines(ctx, text, maxW, max, min, maxLines, fontAt) {
  for (let size = max; size >= min; size -= 4) {
    ctx.font = fontAt(size);
    const lines = recapWrap(ctx, text, maxW, 99);
    if (lines.length <= maxLines) return { size, lines };
  }
  ctx.font = fontAt(min);
  return { size: min, lines: recapWrap(ctx, text, maxW, maxLines) };
}

// ── Blocs : chacun { h, optional?, draw(y) } ───────────────

function recapBlocks(ctx, page, st, c, f, assets, maxW) {
  const { SIDE } = STORY, R = RECAP_STORY, blocks = [];
  const text = (str, font, alpha, y, x = SIDE, w = maxW) => {
    ctx.font = font; ctx.globalAlpha = alpha; ctx.fillStyle = c.fg;
    ctx.fillText(fitText(ctx, str, w), x, y); ctx.globalAlpha = 1;
  };
  const isSummary = page.id === 'summary';
  const fig = assets.body && (isSummary || page.id === 'profile' || page.id === 'sessions') ? assets.body : null;
  const sideFig = page.id !== 'profile' && fig;         // résumé, ouverture : personnage à droite du chiffre
  const heroW = sideFig ? maxW - 330 : maxW;

  // Titre (profil, nom d'exercice) : grand, jusqu'à 3 lignes
  if (page.title) {
    const small = !!page.value && !isSummary;
    // Deux lignes de préférence (à la plus grande taille possible), trois seulement si le texte est long
    const fit = n => recapFitLines(ctx, page.title, maxW, small ? 76 : R.TITLE_MAX, small ? 52 : R.TITLE_MIN, n, s => f(800, s));
    let { size, lines } = fit(small ? 2 : 2);
    if (!small && lines.length > 2) ({ size, lines } = fit(3));
    const lh = Math.round(size * 1.04);
    blocks.push({ h: lines.length * lh, draw: y => {
      ctx.font = f(800, size); setTracking(ctx, -size * .02);
      lines.forEach((l, i) => text(l, f(800, size), 1, y + lh * (i + .82), SIDE, maxW));
      setTracking(ctx, 0);
    } });
  }

  // Chiffre géant (avec « avant → » barré, et son unité)
  if (page.value) {
    const v = recapSplitValue(page.value), unit = page.unit || v.unit, num = v.num || v.unit;
    const max = isSummary ? 250 : R.NUM_MAX;
    const measure = s => {
      ctx.font = storyFont(800, s, true, c.p); const nw = ctx.measureText(num).width;
      ctx.font = storyFont(800, Math.round(s * .38), true, c.p); const uw = v.num && unit ? ctx.measureText(unit).width + s * .08 : 0;
      ctx.font = storyFont(700, Math.round(s * .34), true, c.p);
      const fw = page.from ? ctx.measureText(`${page.from} → `).width + s * .06 : 0;
      return nw + uw + fw;
    };
    let size = max;
    while (size > R.NUM_MIN && measure(size) > heroW) size -= 6;
    blocks.push({ h: Math.round(size * .86), hero: true, draw: y => {
      const base = y + Math.round(size * .78);
      let x = SIDE;
      ctx.fillStyle = c.fg;
      if (page.from) {
        ctx.font = storyFont(700, Math.round(size * .34), true, c.p); ctx.globalAlpha = .55;
        const fw = ctx.measureText(page.from).width;
        ctx.fillText(page.from, x, base);
        ctx.fillRect(x - 4, base - size * .13, fw + 8, Math.max(4, size * .022));
        ctx.globalAlpha = .75;
        ctx.fillText(' →', x + fw, base);
        x += ctx.measureText(`${page.from} → `).width + size * .06; ctx.globalAlpha = 1;
      }
      ctx.font = storyFont(800, size, true, c.p); setTracking(ctx, -size * .04);
      ctx.fillText(num, x - size * .03, base);
      x += ctx.measureText(num).width + size * .05; setTracking(ctx, 0);
      if (v.num && unit) { ctx.font = storyFont(800, Math.round(size * .38), true, c.p); ctx.fillText(unit, x, base); }
    } });
  }
  if (page.caption) {
    ctx.font = f(700, R.CAPTION);
    const lines = recapWrap(ctx, page.caption, heroW, 2);
    blocks.push({ h: lines.length * Math.round(R.CAPTION * 1.2), hero: true, draw: y => lines.forEach((l, i) => text(l, f(700, R.CAPTION), 1, y + R.CAPTION * (1.2 * i + .95), SIDE, heroW)) });
  }
  if (page.note) {
    ctx.font = f(600, R.NOTE);
    const lines = recapWrap(ctx, page.note, heroW, 2), lh = Math.round(R.NOTE * 1.3);
    blocks.push({ h: lines.length * lh, hero: true, draw: y => lines.forEach((l, i) => text(l, f(600, R.NOTE), .8, y + lh * i + R.NOTE, SIDE, heroW)) });
  }

  // Pastilles (ouverture)
  const pills = (items, dot) => {
    ctx.font = f(700, R.TEXT);
    const ph = 76, gap = 16, rows = [[]];
    let rowW = 0;
    items.forEach(t => {
      const w = ctx.measureText(t).width + 56 + (dot ? 32 : 0);
      if (rowW + w > maxW && rows.at(-1).length) { rows.push([]); rowW = 0; }
      rows.at(-1).push([t, w]); rowW += w + gap;
    });
    return { h: rows.length * ph + (rows.length - 1) * gap, draw: y => rows.forEach((row, ri) => {
      let x = SIDE;
      row.forEach(([t, w]) => {
        const ty = y + ri * (ph + gap);
        ctx.globalAlpha = .12; ctx.fillStyle = c.fg; roundRect(ctx, x, ty, w, ph, ph / 2); ctx.fill(); ctx.globalAlpha = 1;
        if (dot) { ctx.fillStyle = c.heat; ctx.beginPath(); ctx.arc(x + 38, ty + ph / 2, 11, 0, Math.PI * 2); ctx.fill(); }
        text(t, f(700, R.TEXT), 1, ty + ph / 2 + R.TEXT * .36, x + 28 + (dot ? 32 : 0), w);
        x += w + gap;
      });
    }) };
  };
  if (page.chips?.length) {
    const b = pills(page.chips, false);
    blocks.push({ ...b, hero: true });
  }

  // Justifications du profil
  if (page.lines?.length && page.id === 'profile') {
    const lh = Math.round(R.TEXT * 1.45);
    blocks.push({ h: page.lines.length * lh, optional: 1, draw: y => page.lines.forEach(([l, v], i) => {
      ctx.font = f(800, R.TEXT); const lw = ctx.measureText(l).width;
      text(l, f(800, R.TEXT), 1, y + lh * i + R.TEXT);
      text(v, f(600, R.TEXT), .85, y + lh * i + R.TEXT, SIDE + lw + 22, maxW - lw - 22);
    }) });
  }

  // Encart (gain d'un record, progression, mois le plus actif)
  if (page.box) {
    ctx.font = f(700, R.TEXT);
    const lines = recapWrap(ctx, page.box, maxW - 88, 2), lh = Math.round(R.TEXT * 1.3), h = lines.length * lh + 64;
    blocks.push({ h, draw: y => {
      ctx.fillStyle = c.box; roundRect(ctx, SIDE, y, maxW, h, 36); ctx.fill();
      ctx.fillStyle = c.boxText; ctx.font = f(700, R.TEXT);
      lines.forEach((l, i) => ctx.fillText(l, SIDE + 44, y + 32 + lh * i + R.TEXT * .9));
    } });
  }

  // Courbe de la meilleure charge
  if (page.curve) {
    const ch = 220, ah = 56;
    blocks.push({ h: ch + ah, optional: 2, draw: y => {
      const ws = page.curve.map(x => x.w), lo = Math.min(...ws), hi = Math.max(...ws), span = hi - lo || 1, pad = 16;
      const pts = page.curve.map((x, i) => [SIDE + pad + i * (maxW - 2 * pad) / (page.curve.length - 1), y + ch - pad - (x.w - lo) / span * (ch - 2 * pad)]);
      ctx.strokeStyle = c.fg; ctx.lineWidth = 9; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath(); pts.forEach(([x, py], i) => i ? ctx.lineTo(x, py) : ctx.moveTo(x, py)); ctx.stroke();
      ctx.fillStyle = c.fg; pts.slice(0, -1).forEach(([x, py]) => { ctx.beginPath(); ctx.arc(x, py, 10, 0, Math.PI * 2); ctx.fill(); });
      const [lx, ly] = pts.at(-1);
      ctx.fillStyle = c.boxText === '#FFFFFF' ? '#FFFFFF' : c.bg; ctx.beginPath(); ctx.arc(lx, ly, 20, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 8; ctx.stroke();
      text(page.curve[0].label, f(700, R.SMALL), .75, y + ch + ah - 8);
      ctx.textAlign = 'right'; text(page.curve.at(-1).label, f(700, R.SMALL), .75, y + ch + ah - 8, SIDE + maxW); ctx.textAlign = 'left';
    } });
  }

  // Frise des semaines
  if (page.strip) {
    const n = page.strip.length, gap = 18, d = Math.min(96, (maxW - (n - 1) * gap) / n), h = d + 64;
    blocks.push({ h, draw: y => {
      page.strip.forEach((w, i) => {
        const cx = SIDE + d / 2 + i * (d + gap), cy = y + d / 2;
        ctx.beginPath(); ctx.arc(cx, cy, d / 2 - 4, 0, Math.PI * 2);
        if (w.on) { ctx.fillStyle = c.fg; ctx.fill(); }
        else { ctx.globalAlpha = .4; ctx.strokeStyle = c.fg; ctx.lineWidth = 7; ctx.stroke(); ctx.globalAlpha = 1; }
      });
      text(page.strip[0].label, f(700, R.SMALL), .75, y + h - 8);
      ctx.textAlign = 'right'; text(page.strip.at(-1).label, f(700, R.SMALL), .75, y + h - 8, SIDE + maxW); ctx.textAlign = 'left';
    } });
  }

  // Séances par mois (année)
  if (page.bars) {
    const bh = 280, lh = 52, n = 12, gap = 14, bw = (maxW - (n - 1) * gap) / n, max = Math.max(1, ...page.bars.values);
    blocks.push({ h: bh + lh, draw: y => page.bars.values.forEach((v, m) => {
      const x = SIDE + m * (bw + gap), hh = Math.max(v ? 18 : 8, v / max * bh);
      ctx.globalAlpha = m === page.bars.top ? 1 : .35; ctx.fillStyle = c.fg;
      roundRect(ctx, x, y + bh - hh, bw, hh, 10); ctx.fill(); ctx.globalAlpha = 1;
      ctx.textAlign = 'center'; text(RECAP_MONTH_NAME(m).charAt(0).toLocaleUpperCase('fr-FR'), f(700, R.SMALL), .75, y + bh + lh - 8, x + bw / 2, bw + gap); ctx.textAlign = 'left';
    }) });
  }

  // Personnage : grand et centré (profil), à droite du haut (résumé)
  if (fig && !sideFig) blocks.push({ h: 0, flex: true, figure: fig });
  if (page.pills?.length) blocks.push(pills(page.pills.map(([l, v]) => `${l} ${v}`), true));

  // Tuiles 2 × 2
  if (page.tiles?.length) {
    const gap = 24, tw = (maxW - gap) / 2, th = isSummary ? 180 : R.TILE, rows = Math.ceil(page.tiles.length / 2), h = rows * th + (rows - 1) * gap;
    blocks.push({ h, draw: y => page.tiles.forEach(([l, v], i) => {
      const x = SIDE + (i % 2) * (tw + gap), ty = y + Math.floor(i / 2) * (th + gap);
      ctx.globalAlpha = .1; ctx.fillStyle = c.fg; roundRect(ctx, x, ty, tw, th, 40); ctx.fill(); ctx.globalAlpha = 1;
      const size = fitSize(ctx, v, tw - 80, Math.min(96, Math.round(th * .46)), 56, s => storyFont(800, s, true, c.p));
      ctx.fillStyle = c.fg; ctx.font = storyFont(800, size, true, c.p); ctx.fillText(v, x + 40, ty + 26 + size * .8);
      text(l, f(700, R.SMALL + 2), .75, ty + th - 30, x + 40, tw - 80);
    }) });
  }

  // Liste (autres records, premières fois ; lignes du résumé)
  const rows = page.list?.length ? page.list.map(x => [x.name, x.value]) : isSummary ? page.lines || [] : [];
  if (rows.length) {
    const rh = 84, h = rows.length * rh + 24;
    blocks.push({ h, optional: 1, draw: y => {
      ctx.globalAlpha = .1; ctx.fillStyle = c.fg; roundRect(ctx, SIDE, y, maxW, h, 36); ctx.fill(); ctx.globalAlpha = 1;
      rows.forEach(([name, val], i) => {
        const base = y + 12 + rh * i + rh * .62;
        if (i) { ctx.globalAlpha = .15; ctx.fillStyle = c.fg; ctx.fillRect(SIDE + 40, y + 12 + rh * i, maxW - 80, 2); ctx.globalAlpha = 1; }
        ctx.font = f(800, R.TEXT); const vw = Math.min(ctx.measureText(val).width, (maxW - 80) * .55);
        ctx.textAlign = 'right'; text(val, f(800, R.TEXT), 1, base, SIDE + maxW - 40, vw); ctx.textAlign = 'left';
        text(name, f(600, R.TEXT), .85, base, SIDE + 40, maxW - 80 - vw - 24);
      });
    } });
  }
  return { blocks, sideFig };
}

// Signature : icône de l'app, « MDLF Training », ce qu'est l'app, et le compte Instagram quand il existera
function recapSignature(ctx, c, f, icon, y) {
  const { SIDE, W } = STORY, s = RECAP_STORY.SIG;
  roundRect(ctx, SIDE, y, s, s, s * .225);
  if (icon?.width) { ctx.save(); ctx.clip(); ctx.drawImage(icon, SIDE, y, s, s); ctx.restore(); }
  else { ctx.fillStyle = c.fg; ctx.fill(); }
  ctx.textAlign = 'left'; ctx.fillStyle = c.fg;
  ctx.font = f(800, 50); setTracking(ctx, -.5); ctx.fillText('MDLF Training', SIDE + s + 26, y + 46); setTracking(ctx, 0);
  ctx.globalAlpha = .75; ctx.font = f(600, 36); ctx.fillText('Suivi de musculation sur iPhone', SIDE + s + 26, y + 90); ctx.globalAlpha = 1;
  if (STORY_INSTAGRAM) {
    ctx.textAlign = 'right'; ctx.font = f(700, 38);
    ctx.fillText(`@${STORY_INSTAGRAM.replace(/^@/, '')}`, W - SIDE, y + 46); ctx.textAlign = 'left';
  }
}

// Image complète d'un écran. page : écran (recapPages), st : récap (recapStats), palette : polices (storyPalette),
// assets : { icon, body } (body : personnage déjà dessiné par bodyMapImage, ou null)
function drawRecapStory(canvas, page, st, palette, assets = {}) {
  canvas.width = STORY.W; canvas.height = STORY.H;
  const ctx = canvas.getContext('2d');
  const { W, H, TOP, BOTTOM, SIDE } = STORY, R = RECAP_STORY, maxW = W - 2 * SIDE;
  const c = { ...(RECAP_TONE_COLORS[page.tone] || RECAP_TONE_COLORS.lime), p: palette };
  const f = (w, s) => storyFont(w, s, false, palette);
  ctx.fillStyle = c.bg; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';

  // En-tête : « MA SEMAINE · 12 – 18 OCTOBRE », puis le surtitre de l'écran (« NOUVEAU RECORD · JEUDI 15 »)
  let y = TOP + 50;
  const mine = `${RECAP_MINE[st.period.kind]} · ${st.period.label}`.toLocaleUpperCase('fr-FR');
  ctx.fillStyle = c.fg; ctx.font = f(800, R.HEAD); setTracking(ctx, 4);
  ctx.fillText(fitText(ctx, mine, maxW), SIDE, y + R.HEAD * .8); y += R.HEAD + 18;
  const own = page.id !== 'summary' && page.kicker !== st.period.title.toLocaleUpperCase('fr-FR');
  if (own) { ctx.globalAlpha = .7; ctx.font = f(700, R.SMALL); ctx.fillText(fitText(ctx, page.kicker, maxW), SIDE, y + R.SMALL * .8); ctx.globalAlpha = 1; y += R.SMALL + 18; }
  setTracking(ctx, 0);
  const top = y + 36, sigY = H - BOTTOM - R.SIG, bottom = sigY - 56;

  const { blocks, sideFig } = recapBlocks(ctx, page, st, c, f, assets, maxW);
  const total = list => list.reduce((a, b) => a + b.h, 0) + Math.max(0, list.length - 1) * R.GAP;
  // Trop haut : on retire d'abord la liste, puis la courbe
  let shown = blocks;
  const FIG_MIN = 460;   // personnage du profil : jamais plus petit (on retire d'abord les lignes facultatives)
  const need = list => total(list) + (list.some(b => b.flex) ? FIG_MIN : 0);
  for (const level of [1, 2]) if (need(shown) > bottom - top) shown = shown.filter(b => b.optional !== level);
  const flex = shown.find(b => b.flex);
  if (flex) flex.h = Math.max(0, Math.min(760, bottom - top - total(shown.filter(b => b !== flex)) - R.GAP));
  const used = total(shown);
  let by = top + Math.max(0, Math.min(260, (bottom - top - used) * .42));
  const heroTop = by;
  shown.forEach(b => {
    if (b.flex) { if (b.h > 120) drawMuscleMap(ctx, SIDE, by, maxW, b.h, b.figure); }
    else b.draw(by);
    by += b.h + R.GAP;
  });
  // Résumé : personnage à droite du titre et du chiffre
  if (sideFig) {
    let fy = heroTop, k = 0;
    for (const b of shown) { if (b.hero) break; fy += b.h + R.GAP; k++; }
    const heroH = shown.slice(k).filter(b => b.hero).reduce((a, b) => a + b.h + R.GAP, 0) - R.GAP;
    drawMuscleMap(ctx, W - SIDE - 310, fy - 10, 310, Math.max(420, heroH + 20), sideFig);
  }
  recapSignature(ctx, c, f, assets.icon, sigY);
  return canvas;
}

// Image d'un écran de récap dans un canvas (personnage : silhouette des réglages, muscles de la période)
async function renderRecapStory(page, st, canvas = document.createElement('canvas')) {
  const palette = storyPalette('var(--green)');
  const tone = RECAP_TONE_COLORS[page.tone] || RECAP_TONE_COLORS.lime;
  const wantBody = page.body && Object.keys(page.body).length && ['summary', 'profile', 'sessions'].includes(page.id);
  const [icon, body] = await Promise.all([
    loadImage('icon-192.png'),
    wantBody ? bodyMapImage(page.body, { view: page.id === 'profile' ? 'both' : 'front', colors: { heat: tone.heat, bright: 1 } }).catch(() => null) : null,
  ]);
  drawRecapStory(canvas, page, st, palette, { icon, body });
  return { canvas };
}
