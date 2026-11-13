// ═══════════════════════════════════════════════════════════
//  Récaps : dessin de l'image story (1080 × 1920) d'un écran
// ═══════════════════════════════════════════════════════════
'use strict';

// Même mise en page que l'écran (js/features/recap.js) : aplat de la couleur de l'écran (css/recap.css),
// chiffre géant, puis les blocs de l'écran (tuiles, avant → après, courbe, frise, personnage…), et la signature
// « MDLF Training » au même endroit sur toutes les stories : c'est elle qui fait connaître l'app à chaque
// partage. Direction « sobre » : deux aplats seulement, l'orange MDLF (accent) et le noir (night), aucun violet
// ni citron vert ; l'orange suit le thème de l'app (#FF7A1A et texte noir en sombre, #A85400 et texte blanc en
// clair), le noir est le même partout. Zones d'Instagram (STORY.TOP, STORY.BOTTOM, share-canvas.js) laissées
// vides ; rien sous 36 px (lisible en vignette). Jamais de poids du corps ni de mensuration dans l'image.
const RECAP_TONE_COLORS = {
  accent: { bg: '#FF7A1A', fg: '#000000', heat: '#000000', box: '#000000', boxText: '#FFFFFF' },
  night:  { bg: '#000000', fg: '#FFFFFF', heat: '#FF7A1A', box: '#1C1C1E', boxText: '#FFFFFF' },
};
const RECAP_TONE_LIGHT = { accent: { bg: '#A85400', fg: '#FFFFFF', heat: '#000000', box: '#FFFFFF', boxText: '#000000' } };
// Couleurs d'un écran dans le thème de l'app (light : thème clair) ; ton inconnu : l'orange
function recapToneColors(tone, light) {
  const t = Object.hasOwn(RECAP_TONE_COLORS, tone) ? tone : 'accent';
  return (light && RECAP_TONE_LIGHT[t]) || RECAP_TONE_COLORS[t];
}
// Personnage du profil (écran noir) : l'orange de Progrès en sombre, un seul, l'intensité dit le palier
const RECAP_BODY = { heat: '#FF7A1A', peak: '#FF7A1A' };
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
  const fig = assets.body && (page.id === 'profile' || page.id === 'sessions') ? assets.body : null;
  const sideFig = page.id !== 'profile' && fig;         // ouverture : personnage à droite du chiffre
  const heroW = sideFig ? maxW - 330 : maxW;

  // Petit texte sur 1 à 3 lignes (pourquoi ce fait, palier, explications)
  const para = (str, size, weight, alpha, w, maxLines, extra = {}) => {
    ctx.font = f(weight, size);
    const lines = recapWrap(ctx, str, w, maxLines), lh = Math.round(size * 1.3);
    return { h: lines.length * lh, ...extra, draw: y => lines.forEach((l, i) => text(l, f(weight, size), alpha, y + lh * i + size, SIDE, w)) };
  };
  if (page.lead) blocks.push(para(page.lead, R.TEXT, 700, 1, maxW, 2));

  // Titre (profil, nom d'exercice) : grand, jusqu'à 3 lignes
  if (page.title) {
    const small = !!page.value && !isSummary;
    // Deux lignes de préférence (à la plus grande taille possible), trois seulement si le texte est long
    const fit = n => recapFitLines(ctx, page.title, maxW, small ? 76 : R.TITLE_MAX, small ? 52 : R.TITLE_MIN, n, s => f(800, s));
    let { size, lines } = fit(isSummary ? 1 : 2);   // résumé : « Mon mois en bref » sur une ligne
    if (!small && !isSummary && lines.length > 2) ({ size, lines } = fit(3));
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
    const max = R.NUM_MAX;
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
      const w = ctx.measureText(t).width + 56 + (dot ? 52 : 0);
      if (rowW + w > maxW && rows.at(-1).length) { rows.push([]); rowW = 0; }
      rows.at(-1).push([t, w, rows.flat().length]); rowW += w + gap;
    });
    return { h: rows.length * ph + (rows.length - 1) * gap, draw: y => rows.forEach((row, ri) => {
      let x = SIDE;
      row.forEach(([t, w, idx]) => {
        const ty = y + ri * (ph + gap);
        ctx.globalAlpha = .12; ctx.fillStyle = c.fg; roundRect(ctx, x, ty, w, ph, ph / 2); ctx.fill(); ctx.globalAlpha = 1;
        if (dot) {
          // Rang (1, 2, 3) dans une pastille de la couleur des muscles
          ctx.fillStyle = c.heat; ctx.beginPath(); ctx.arc(x + 44, ty + ph / 2, 22, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = c.bg; ctx.font = f(800, 26); ctx.textAlign = 'center';
          ctx.fillText(String(idx + 1), x + 44, ty + ph / 2 + 9); ctx.textAlign = 'left';
        }
        text(t, f(700, R.TEXT), 1, ty + ph / 2 + R.TEXT * .36, x + 28 + (dot ? 52 : 0), w);
        x += w + gap;
      });
    }) };
  };
  if (page.chips?.length) {
    const b = pills(page.chips, false);
    blocks.push({ ...b, hero: true });
  }
  // Palier franchi (ouverture) : encart léger sous les pastilles
  if (page.mention) {
    ctx.font = f(700, R.SMALL);
    const lines = recapWrap(ctx, page.mention, heroW - 64, 2), lh = Math.round(R.SMALL * 1.3), h = lines.length * lh + 40;
    blocks.push({ h, hero: true, draw: y => {
      ctx.globalAlpha = .12; ctx.fillStyle = c.fg; roundRect(ctx, SIDE, y, heroW, h, 28); ctx.fill(); ctx.globalAlpha = 1;
      lines.forEach((l, i) => text(l, f(700, R.SMALL), 1, y + 20 + lh * i + R.SMALL * .85, SIDE + 32, heroW - 64));
    } });
  }

  // Justifications du profil : le libellé, puis sa preuve en dessous, sur 2 lignes au plus (« Plutôt le soir » /
  // « Entre 18 h et 23 h · 8 séances sur 11 »). Un bloc par ligne : faute de place, elles partent une à une
  // en partant de la dernière, jamais toutes d'un coup.
  if (page.lines?.length && page.id === 'profile') {
    const lh = Math.round(R.TEXT * 1.25), sl = Math.round(R.SMALL * 1.25);
    page.lines.forEach(([l, v]) => {
      ctx.font = f(600, R.SMALL);
      const vals = recapWrap(ctx, v, maxW, 2);
      blocks.push({ h: lh + vals.length * sl, optional: 1, draw: y => {
        text(l, f(800, R.TEXT), 1, y + R.TEXT);
        vals.forEach((x, k) => text(x, f(600, R.SMALL), .85, y + lh + sl * k + R.SMALL));
      } });
    });
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
  if (page.foot) blocks.push(para(page.foot, R.SMALL, 600, .8, maxW, 2, { optional: 1 }));

  // Courbe de la meilleure charge
  if (page.curve) {
    const ah = 56;
    const b = { h: 220 + ah, minH: 140 + ah, optional: 2 };
    blocks.push(Object.assign(b, { draw: y => {
      const ch = b.h - ah;
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
    } }));
  }

  // Frise des semaines : une pastille par semaine avec son nombre de séances (pleine à l'objectif), sa date dessous
  if (page.strip) {
    const n = page.strip.length, gap = 18, d = Math.min(120, (maxW - (n - 1) * gap) / n), h = d + 64, all = n <= 6;
    blocks.push({ h, draw: y => {
      page.strip.forEach((w, i) => {
        const cx = SIDE + d / 2 + i * (d + gap), cy = y + d / 2;
        ctx.beginPath(); ctx.arc(cx, cy, d / 2 - 4, 0, Math.PI * 2);
        if (w.on) { ctx.fillStyle = c.fg; ctx.fill(); }
        else { ctx.globalAlpha = .45; ctx.strokeStyle = c.fg; ctx.lineWidth = 7; ctx.stroke(); ctx.globalAlpha = 1; }
        const ns = Math.round(d * .46);
        ctx.font = storyFont(800, ns, true, c.p); ctx.textAlign = 'center'; ctx.fillStyle = w.on ? c.bg : c.fg;
        ctx.fillText(String(w.n), cx, cy + ns * .36);
        if (all) text(w.label, f(700, R.SMALL), .8, y + h - 8, cx, d + gap);
        ctx.textAlign = 'left';
      });
      if (!all) {
        text(page.strip[0].label, f(700, R.SMALL), .8, y + h - 8);
        ctx.textAlign = 'right'; text(page.strip.at(-1).label, f(700, R.SMALL), .8, y + h - 8, SIDE + maxW); ctx.textAlign = 'left';
      }
    } });
    if (page.stripNote) blocks.push(para(page.stripNote, R.SMALL, 600, .8, maxW, 2, { optional: 1 }));
  }

  // Séances par mois (année)
  if (page.bars) {
    const lh = 52, n = 12, gap = 14, bw = (maxW - (n - 1) * gap) / n, max = Math.max(1, ...page.bars.values);
    const b = { h: 280 + lh, minH: 150 + lh };
    blocks.push(Object.assign(b, { draw: y => page.bars.values.forEach((v, m) => {
      const bh = b.h - lh;
      const x = SIDE + m * (bw + gap), hh = Math.max(v ? 18 : 8, v / max * bh);
      ctx.globalAlpha = m === page.bars.top ? 1 : .35; ctx.fillStyle = c.fg;
      roundRect(ctx, x, y + bh - hh, bw, hh, 10); ctx.fill(); ctx.globalAlpha = 1;
      ctx.textAlign = 'center'; text(RECAP_MONTH_NAME(m).charAt(0).toLocaleUpperCase('fr-FR'), f(700, R.SMALL), .75, y + bh + lh - 8, x + bw / 2, bw + gap); ctx.textAlign = 'left';
    }) }));
  }

  // Personnage : grand et centré (profil), à droite du haut (résumé)
  if (fig && !sideFig) blocks.push({ h: 0, flex: true, figure: fig });
  // Légende du personnage du profil : paliers de Progrès (pastille, nom, bornes), puis l'unité (comme .rp-scale)
  if (fig && !sideFig && page.scale) {
    const items = MUSCLE_LEVEL_WORDS.slice(1).map((w, i) => ({ lvl: i + 1, t: `${w} ${muscleLevelRange(i + 1)}` }));
    blocks.push({ h: 160, draw: y => {
      ctx.font = f(700, 30);
      const sq = 24, gap = 40;
      // Deux paliers par ligne (quatre sur une seule ligne déborderaient du 1080 px)
      [items.slice(0, 2), items.slice(2)].forEach((row, r) => {
        const ws = row.map(it => sq + 12 + ctx.measureText(it.t).width), ry = y + r * 50;
        let x = SIDE + maxW / 2 - (ws.reduce((a, b) => a + b, 0) + gap * (row.length - 1)) / 2;
        row.forEach((it, k) => {
          ctx.fillStyle = 'rgba(255,255,255,.35)'; roundRect(ctx, x, ry + 6, sq, sq, 6); ctx.fill();
          ctx.globalAlpha = it.lvl >= MUSCLE_LEVEL_MAX ? 1 : bodyHeatOpacity(it.lvl / MUSCLE_LEVEL_MAX);
          ctx.fillStyle = it.lvl >= MUSCLE_LEVEL_MAX ? RECAP_BODY.peak : RECAP_BODY.heat; roundRect(ctx, x, ry + 6, sq, sq, 6); ctx.fill();
          ctx.globalAlpha = 1;
          text(it.t, f(700, 30), 1, ry + 29, x + sq + 12, ws[k]);
          x += ws[k] + gap;
        });
      });
      ctx.textAlign = 'center'; text(page.scale, f(600, 30), .8, y + 134, SIDE + maxW / 2, maxW); ctx.textAlign = 'left';
    } });
  }
  // Profil : les pastilles partent avant les lignes de preuve (le personnage montre déjà les muscles)
  if (page.pills?.length) blocks.push({ ...pills(page.pills.map(([l, v]) => `${l} ${v}`), true), ...(page.id === 'profile' ? { optional: 1 } : {}) });

  // Tuiles 2 × 2
  if (page.tiles?.length) {
    const gap = 24, tw = (maxW - gap) / 2, th = isSummary ? 180 : R.TILE, rows = Math.ceil(page.tiles.length / 2), h = rows * th + (rows - 1) * gap;
    blocks.push({ h, draw: y => page.tiles.forEach(([l, v], i) => {
      const x = SIDE + (i % 2) * (tw + gap), ty = y + Math.floor(i / 2) * (th + gap);
      ctx.globalAlpha = .1; ctx.fillStyle = c.fg; roundRect(ctx, x, ty, tw, th, 40); ctx.fill(); ctx.globalAlpha = 1;
      const size = fitSize(ctx, v, tw - 80, Math.min(96, Math.round(th * .46)), 56, s => storyFont(800, s, true, c.p));
      ctx.fillStyle = c.fg; ctx.font = storyFont(800, size, true, c.p); ctx.fillText(v, x + 40, ty + 26 + size * .8);
      const ls = fitSize(ctx, l, tw - 64, R.SMALL + 2, R.SMALL, s => f(700, s));
      text(l, f(700, ls), .75, ty + th - 30, x + 40, tw - 64);
    }) });
  }

  // Liste (autres records avec leur gain, paliers de séances) : nom à gauche, valeur à droite, gain dessous
  if (page.list?.length) {
    // Faute de place, la liste perd ses dernières lignes (fewer) ; son titre ne reste jamais seul (needs)
    const all = page.list.map(x => [x.name, x.value, x.gain || '']).concat(page.more ? [[page.more, '', '']] : []);
    const rhOf = r => (r[2] ? 120 : 84);
    const listBlock = rows => {
      const h = rows.reduce((a, r) => a + rhOf(r), 0) + 24;
      return { h, optional: 1, fewer: rows.length > 1 ? () => listBlock(rows.slice(0, -1)) : null, draw: y => {
      ctx.globalAlpha = .1; ctx.fillStyle = c.fg; roundRect(ctx, SIDE, y, maxW, h, 36); ctx.fill(); ctx.globalAlpha = 1;
      let ry = y + 12;
      rows.forEach(([name, val, gain], i) => {
        const rh = rhOf([name, val, gain]), base = ry + (gain ? 52 : rh * .62);
        if (i) { ctx.globalAlpha = .15; ctx.fillStyle = c.fg; ctx.fillRect(SIDE + 40, ry, maxW - 80, 2); ctx.globalAlpha = 1; }
        ctx.font = f(800, R.TEXT); const vw = val ? Math.min(ctx.measureText(val).width, (maxW - 80) * .55) : 0;
        if (val) { ctx.textAlign = 'right'; text(val, f(800, R.TEXT), 1, base, SIDE + maxW - 40, vw); ctx.textAlign = 'left'; }
        text(name, f(val ? 600 : 700, val ? R.TEXT : R.SMALL), val ? .85 : .75, base, SIDE + 40, maxW - 80 - vw - (val ? 24 : 0));
        if (gain) text(gain, f(700, R.SMALL), .7, base + 46, SIDE + 40, maxW - 80);
        ry += rh;
      });
    } };
    };
    const list = listBlock(all);
    if (page.listTitle) blocks.push(para(page.listTitle.toLocaleUpperCase('fr-FR'), R.SMALL, 800, .8, maxW, 1, { optional: 1, needs: 'list' }));
    blocks.push({ ...list, role: 'list' });
  }
  // Lignes du résumé : le libellé en petit, la valeur dessous en gras (jamais coupée par la valeur d'à côté).
  // Faute de place, les lignes partent une à une depuis la dernière (fewer), pas tout l'encart.
  if (isSummary && page.lines?.length) {
    ctx.font = f(800, R.TEXT);
    const vl = Math.round(R.TEXT * 1.2), all = page.lines.map(([label, val]) => ({ label, vals: recapWrap(ctx, val, maxW - 80, 2) }));
    const rhOf = r => 62 + r.vals.length * vl;
    const linesBlock = rows => {
      const h = rows.reduce((a, r) => a + rhOf(r), 0) + 24;
      return { h, optional: 1, fewer: rows.length > 1 ? () => linesBlock(rows.slice(0, -1)) : null, draw: y => {
      ctx.globalAlpha = .1; ctx.fillStyle = c.fg; roundRect(ctx, SIDE, y, maxW, h, 36); ctx.fill(); ctx.globalAlpha = 1;
      let ry = y + 12;
      rows.forEach((r, i) => {
        if (i) { ctx.globalAlpha = .15; ctx.fillStyle = c.fg; ctx.fillRect(SIDE + 40, ry, maxW - 80, 2); ctx.globalAlpha = 1; }
        text(r.label, f(700, R.SMALL), .7, ry + 44, SIDE + 40, maxW - 80);
        r.vals.forEach((v, k) => text(v, f(800, R.TEXT), 1, ry + 44 + vl * (k + 1), SIDE + 40, maxW - 80));
        ry += rhOf(r);
      });
    } };
    };
    blocks.push(linesBlock(all));
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
  const c = { ...recapToneColors(page.tone, palette.light), p: palette };
  const f = (w, s) => storyFont(w, s, false, palette);
  ctx.fillStyle = c.bg; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';

  // En-tête : « MA SEMAINE · 12 – 18 OCTOBRE », puis le surtitre de l'écran (« NOUVEAU RECORD · JEUDI 15 »)
  let y = TOP + 50;
  const mine = (page.id === 'summary' ? st.period.label : `${RECAP_MINE[st.period.kind]} · ${st.period.label}`).toLocaleUpperCase('fr-FR');
  ctx.fillStyle = c.fg; ctx.font = f(800, R.HEAD); setTracking(ctx, 4);
  ctx.fillText(fitText(ctx, mine, maxW), SIDE, y + R.HEAD * .8); y += R.HEAD + 18;
  const own = page.id !== 'summary' && page.kicker !== st.period.title.toLocaleUpperCase('fr-FR');
  if (own) { ctx.globalAlpha = .7; ctx.font = f(700, R.SMALL); ctx.fillText(fitText(ctx, page.kicker, maxW), SIDE, y + R.SMALL * .8); ctx.globalAlpha = 1; y += R.SMALL + 18; }
  setTracking(ctx, 0);
  const top = y + 36, sigY = H - BOTTOM - R.SIG, bottom = sigY - 56;

  const { blocks, sideFig } = recapBlocks(ctx, page, st, c, f, assets, maxW);
  const total = list => list.reduce((a, b) => a + b.h, 0) + Math.max(0, list.length - 1) * R.GAP;
  let shown = blocks;
  const FIG_MIN = 340;   // personnage du profil : jamais plus petit ; assez bas pour garder les lignes de preuve (moment, groupes)
  const need = list => total(list) + (list.some(b => b.flex) ? FIG_MIN : 0);
  // Trop haut : les blocs facultatifs partent un à un depuis le bas (niveau 1, puis 2) ; un bloc qui sait
  // se raccourcir (fewer : lignes du résumé) perd d'abord ses dernières lignes
  for (const level of [1, 2]) {
    while (need(shown) > bottom - top) {
      const i = shown.findLastIndex(b => b.optional === level);
      if (i < 0) break;
      const b = shown[i];
      if (b.fewer) shown[i] = { ...b.fewer(), role: b.role }; else shown.splice(i, 1);
    }
  }
  shown = shown.filter(b => !b.needs || shown.some(x => x.role === b.needs));   // titre sans sa liste : retiré
  // Encore trop haut : courbe et barres se tassent (jamais sous minH)
  let over = need(shown) - (bottom - top);
  for (const b of shown) if (over > 0 && b.minH) { const cut = Math.min(over, b.h - b.minH); b.h -= cut; over -= cut; }
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
  // Ouverture : personnage à droite du titre et du chiffre
  if (sideFig) {
    let fy = heroTop, k = 0;
    for (const b of shown) { if (b.hero) break; fy += b.h + R.GAP; k++; }
    const heroH = shown.slice(k).filter(b => b.hero).reduce((a, b) => a + b.h + R.GAP, 0) - R.GAP;
    drawMuscleMap(ctx, W - SIDE - 310, fy - 10, 310, heroH + 10, sideFig);   // jamais sur les tuiles d'en dessous
  }
  recapSignature(ctx, c, f, assets.icon, sigY);
  return canvas;
}

// Image d'un écran de récap dans un canvas (personnage : silhouette des réglages, muscles de la période)
async function renderRecapStory(page, st, canvas = document.createElement('canvas')) {
  const palette = storyPalette('var(--green)');
  const tone = recapToneColors(page.tone, palette.light);
  const wantBody = page.body && Object.keys(page.body).length && ['profile', 'sessions'].includes(page.id);
  const [icon, body] = await Promise.all([
    loadImage('icon-192.png'),
    wantBody ? bodyMapImage(page.body, { view: page.id === 'profile' ? 'both' : 'front', colors: page.id === 'profile' ? { ...RECAP_BODY, bright: 1 } : { heat: tone.heat, bright: 1 } }).catch(() => null) : null,
  ]);
  drawRecapStory(canvas, page, st, palette, { icon, body });
  return { canvas };
}
