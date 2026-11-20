// ═══════════════════════════════════════════════════════════
//  Affiche du coach (20/11/2026), une seule mise en page, « photo ronde », choisie par Maxence parmi quatre concepts
//  (docs/AFFICHE_COACH.md) : titre énorme (NOUVEAU / NOUVELLE COACH ou COACH), photo ronde cerclée d'orange devant le
//  personnage 3D aux muscles rouges en entier (silhouette femme ou homme choisie par le coach), nom, « Sur MDLF
//  Training », code. Un seul fond, le noir. Personnage grand et bien visible, comme le concept du vote (v2) que
//  Maxence a gardé : même taille, même cadrage, muscles rouge vif, au plus un léger assombrissement uniforme.
//  Contenu : js/data/coach-poster.js ; aperçu : js/features/coach-poster-ui.js.
//
//  Règles anti « design IA » de l'app (mémoire feedback_design_pas_ia) : noir pur, un seul orange plein (#FF7A1A, celui
//  de l'app en sombre), blanc plein, aucun dégradé, aucune lueur, aucun halo ni vignettage, aucune ombre, aucun verre ;
//  petits textes en casse normale (SF Pro), jamais en capitales espacées ; gros titres (titre, nom, code) en capitales
//  Anton (police OFL embarquée), serrées. 3e panel (20/11) : la story reprend la composition du carré, en vertical :
//  titre en haut, puis personnage ENTIER à gauche (environ 45 %) et, à droite, photo ronde, nom, « @pseudo · Sur MDLF
//  Training » en blanc, badge, code et signature. Rien n'est posé sur le corps, donc aucun contour, bande ni masque.
//  Zones d'Instagram : tout le texte entre 250 et 1650 px.
//  La photo du coach n'est jamais remplacée par le personnage : sans photo, ses initiales dans le rond.
// ═══════════════════════════════════════════════════════════
'use strict';

// Couleurs : thème sombre de l'app (css/base.css, css/theme-sobre.css). Noir sur #FF7A1A : 8,1:1.
const CPA = {
  bg: '#000000', orange: '#FF7A1A', white: '#FFFFFF', ink: '#1C1C1E',
  grey: '#A0A0A7',     // rgba(235,235,245,.68) de l'app posé sur le noir, rendu opaque
  // Personnage exactement comme l'atlas de l'app en sombre (branche affichage-e, commit 5e2aaa85) : corps à
  // --body-atlas-bright .46 (filter: brightness), muscles --body-heat #FF453A éclairés par l'ombrage du calque
  // (background-blend-mode: soft-light), tous en rouge plein comme un muscle ciblé
  heat: '#FF453A',
  atlasBright: 0.46,
  bodyDim: 0,          // rien de plus : le personnage tel qu'il est dans l'app
  title: '"MDLF Anton", "Anton", Impact, "Arial Narrow Bold", sans-serif',
  text: '-apple-system, "SF Pro Text", system-ui, "Helvetica Neue", Arial, sans-serif',
  safeTop: 250,
};
const CPA_FEMALE_SKIP = ['chest_sternal', 'chest_abdominal'];
const cpaTitle = s => `400 ${Math.round(s)}px ${CPA.title}`;
const cpaText = (s, w = 600) => `${w} ${Math.round(s)}px ${CPA.text}`;
// Code d'invitation : SF Pro Display Heavy, large et lisible (« VV » ne se lit pas « W », « 5 » pas « S »), pas l'Anton serrée
const cpaCode = s => `800 ${Math.round(s)}px -apple-system, "SF Pro Display", system-ui, "Helvetica Neue", Arial, sans-serif`;

// Police Anton chargée avant le dessin (sinon le canvas prend la police de secours)
async function cpaFontsReady() {
  if (typeof document === 'undefined' || !document.fonts?.load) return;
  try { await document.fonts.load(cpaTitle(100)); } catch { /* police absente : police de secours */ }
}

// Taille la plus grande (pas de 2) qui fait tenir le texte sur maxW
function cpaFit(ctx, text, maxW, max, min, fontAt) {
  let s = max;
  for (; s > min; s -= 2) {
    ctx.font = fontAt(s);
    if (ctx.measureText(text).width <= maxW) break;
  }
  ctx.font = fontAt(s);
  return s;
}

// Nom en capitales sur une ligne, ou deux (prénom, puis le reste) si une ligne tomberait sous les trois quarts de max.
// Dernier recours (mot très long) : une taille sous le minimum plutôt qu'un débordement.
function cpaNameLines(ctx, name, maxW, max, min) {
  const up = String(name || '').toLocaleUpperCase('fr-FR');
  const s1 = cpaFit(ctx, up, maxW, max, min, cpaTitle);
  const words = up.split(' ');
  let r = { lines: [up], size: s1 };
  if (words.length > 1 && s1 < max * 0.75) {
    const lines = [words[0], words.slice(1).join(' ')];
    const s2 = Math.min(...lines.map(l => cpaFit(ctx, l, maxW, max, min, cpaTitle)));
    if (s2 > s1 * 1.2) r = { lines, size: s2 };
  }
  ctx.font = cpaTitle(100);
  r.size = Math.min(r.size, ...r.lines.map(l => 100 * maxW / Math.max(1, ctx.measureText(l).width)));
  return r;
}

// Image recadrée en « cover » dans w × h, point d'intérêt fx, fy (0..1)
function cpaCover(img, w, h, { fx = 0.5, fy = 0.35 } = {}) {
  const c = document.createElement('canvas');
  c.width = Math.round(w); c.height = Math.round(h);
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const k = Math.max(w / iw, h / ih), dw = iw * k, dh = ih * k;
  c.getContext('2d').drawImage(img, (w - dw) * fx, (h - dh) * fy, dw, dh);
  return c;
}

// Calque d'un muscle comme en CSS (background-color + background-image, background-blend-mode: soft-light, puis
// mask-image du même calque) : la couleur, le calque gris posé dessus en lumière douce, découpé par son alpha
function cpaSoftLightLayer(img, color) {
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const x = c.getContext('2d');
  x.fillStyle = color; x.fillRect(0, 0, c.width, c.height);
  x.globalCompositeOperation = 'soft-light'; x.drawImage(img, 0, 0);
  x.globalCompositeOperation = 'destination-in'; x.drawImage(img, 0, 0);
  return c;
}

// Personnage 3D de face, à la résolution ×3 de l'atlas (1152 × 2520), rendu comme l'atlas de l'app en sombre : corps
// assombri (brightness .46 = noir à 54 % posé dessus), chaque muscle superficiel en #FF453A éclairé par son calque en
// lumière douce, découpé à sa forme. kind : 'male' ou 'female'. null si une image manque.
async function cpaHeroBody(kind = 'male') {
  const k = BODY_PARTS.boxes[kind] ? kind : 'male', boxes = BODY_PARTS.boxes[k].front;
  const base = await bodyLoadImage(body2Url(k, 'front', 'base@3x.webp'));
  if (!base) return null;
  const c = document.createElement('canvas');
  c.width = BODY_PARTS.w3; c.height = BODY_PARTS.h3;
  const x = c.getContext('2d');
  x.drawImage(base, 0, 0, c.width, c.height);
  x.globalCompositeOperation = 'source-atop';
  x.fillStyle = `rgba(0,0,0,${1 - CPA.atlasBright})`; x.fillRect(0, 0, c.width, c.height);
  x.globalCompositeOperation = 'source-over';
  // Silhouette femme : les calques des faisceaux moyen et bas du grand pectoral couvrent la poitrine (l'atlas n'a pas de
  // maillage du tissu mammaire séparé) : ils restent au gris du corps sur l'affiche ; le faisceau claviculaire, au-dessus,
  // reste rouge
  const skip = k === 'female' ? CPA_FEMALE_SKIP : [];
  const parts = BODY_PARTS.parts.filter(p => boxes[p.id] && !p.deep && !skip.includes(p.id));
  const imgs = await Promise.all(parts.map(p => bodyLoadImage(body2Url(k, 'front', `p3/${p.id}.webp`))));
  parts.forEach((p, i) => {
    if (!imgs[i]) return;
    const b = boxes[p.id][1];
    x.drawImage(cpaSoftLightLayer(imgs[i], CPA.heat), b[0], b[1], b[2] - b[0], b[3] - b[1]);
  });
  return c;
}

// ── Aides de dessin ─────────────────────────────────────────

function cpaText1(ctx, text, x, y, { font, color = CPA.white, align = 'center' }) {
  ctx.font = font; ctx.textAlign = align; ctx.fillStyle = color;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';   // jamais de lettres espacées
  ctx.fillText(text, x, y);
}
function cpaRound(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else { ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
}
// Plus aucun texte n'est posé sur le personnage (3e panel) : couleurs pleines sur le noir pur, sans contour
const cpaTitleText = (ctx, text, x, y, size, color) => cpaText1(ctx, text, x, y, { font: cpaTitle(size), color });
const cpaSmallText = (ctx, text, x, y, size, color = CPA.white, align = 'center') => cpaText1(ctx, text, x, y, { font: cpaText(size, 600), color, align });
// Signature : icône de l'app et « MDLF Training » (comme l'image d'une séance)
function cpaBrand(ctx, icon, cx, y, size) {
  ctx.font = cpaText(size * 0.62, 700);
  const tw = ctx.measureText('MDLF Training').width, gap = size * 0.3, x = cx - (size + gap + tw) / 2;
  if (icon?.width) { ctx.save(); cpaRound(ctx, x, y, size, size, size * 0.225); ctx.clip(); ctx.drawImage(icon, x, y, size, size); ctx.restore(); }
  cpaSmallText(ctx, 'MDLF Training', x + size + gap, y + size * 0.72, size * 0.62, CPA.white, 'left');
}
// Bloc de l'appel : consigne puis code, en noir sur l'orange plein. Consigne trop longue pour rester lisible (minSize)
// sur une ligne : deux lignes, coupées avant « et »
function cpaCodePill(ctx, m, cx, y, w, h, minSize = 0) {
  cpaRound(ctx, cx - w / 2, y, w, h, Math.min(28, h / 2)); ctx.fillStyle = CPA.orange; ctx.fill();
  let lines = [m.ctaLine], ls = cpaFit(ctx, m.ctaLine, w - 60, h * 0.19, h * 0.12, z => cpaText(z, 600));
  ctx.font = cpaText(ls, 600);
  if (minSize && (ls < minSize || ctx.measureText(m.ctaLine).width > w - 60) && / et /.test(m.ctaLine)) {
    const k = m.ctaLine.indexOf(' et ');
    lines = [m.ctaLine.slice(0, k), m.ctaLine.slice(k + 1)];
    ls = Math.min(...lines.map(l => cpaFit(ctx, l, w - 60, h * 0.16, minSize * 0.8, z => cpaText(z, 600))));
  }
  const top = y + h * (lines.length > 1 ? 0.22 : 0.33);
  lines.forEach((l, i) => cpaText1(ctx, l, cx, top + i * ls * 1.15, { font: cpaText(ls, 600), color: CPA.bg }));
  const codeTop = top + (lines.length - 1) * ls * 1.15 + h * 0.05;
  const s = cpaFit(ctx, m.code, w - 80, h * (lines.length > 1 ? 0.32 : 0.4), h * 0.22, cpaCode);
  cpaText1(ctx, m.code, cx, codeTop + s * 1.0, { font: cpaCode(s), color: CPA.bg });
}
// Badge « Carte pro déclarée » (s'il est affiché) : pastille au trait blanc (contour noir autour), texte détouré ;
// renvoie sa hauteur
function cpaBadge(ctx, m, cx, y, size) {
  if (!m.badge) return 0;
  ctx.font = cpaText(size, 600);
  const w = ctx.measureText(m.badge).width + size * 1.6, h = size * 1.8;
  cpaRound(ctx, cx - w / 2, y, w, h, h / 2);
  ctx.strokeStyle = CPA.white; ctx.lineWidth = 3; ctx.stroke();
  cpaSmallText(ctx, m.badge, cx, y + h * 0.66, size, CPA.white);
  return h;
}

// Bloc d'identité posé de haut en bas sous la photo : nom (une ligne, réduit s'il le faut), spécialité, « @pseudo · Sur
// MDLF Training », badge. draw = false : mesure seule. Renvoie le bas du bloc
function cpaIdentityDown(ctx, m, { x, top, maxW, name: [nMax, nMin], subSize, gap, draw = true }) {
  let y = top;
  if (m.name) {
    const up = m.name.toLocaleUpperCase('fr-FR');
    let ns = cpaFit(ctx, up, maxW, nMax, nMin, cpaTitle);
    ctx.font = cpaTitle(100); ns = Math.min(ns, 100 * maxW / Math.max(1, ctx.measureText(up).width));
    y += ns * 0.98;   // place des accents (É) au-dessus des capitales
    if (draw) cpaTitleText(ctx, up, x, y, ns, CPA.white);
    y += gap;
  }
  if (m.specialty) {
    const sp = cpaFit(ctx, m.specialty, maxW, subSize * 1.1, subSize * 0.6, z => cpaText(z, 600));
    y += sp;
    if (draw) cpaText1(ctx, m.specialty, x, y, { font: cpaText(sp, 600), color: CPA.white });
    y += gap;
  }
  const sub = [m.handle, 'Sur MDLF Training'].filter(Boolean).join(' · ');
  const ss = cpaFit(ctx, sub, maxW, subSize, Math.round(subSize * 0.55), z => cpaText(z, 600));
  y += ss;
  if (draw) cpaSmallText(ctx, sub, x, y, ss);
  y += gap;
  if (m.badge) { const bh = Math.round(subSize * 0.8 * 1.8); if (draw) cpaBadge(ctx, m, x, y, subSize * 0.8); y += bh; }
  return y;
}

// Photo ronde cerclée d'un trait orange plein, ou initiales
function cpaPhotoRound(ctx, m, a, cx, my, d) {
  ctx.beginPath(); ctx.arc(cx, my + d / 2, d / 2 + 16, 0, Math.PI * 2); ctx.fillStyle = CPA.orange; ctx.fill();
  ctx.beginPath(); ctx.arc(cx, my + d / 2, d / 2 + 4, 0, Math.PI * 2); ctx.fillStyle = CPA.bg; ctx.fill();
  ctx.save(); ctx.beginPath(); ctx.arc(cx, my + d / 2, d / 2, 0, Math.PI * 2); ctx.clip();
  if (m.photo && a.photo) ctx.drawImage(cpaCover(a.photo, d, d, { fy: 0.25 }), cx - d / 2, my, d, d);
  else { ctx.fillStyle = CPA.ink; ctx.fillRect(cx - d / 2, my, d, d); cpaText1(ctx, m.initials, cx, my + d * 0.65, { font: cpaTitle(d * 0.42) }); }
  ctx.restore();
}
// Titre sur une ou deux lignes (NOUVEAU / COACH), centré en x, à partir de top ; renvoie son bas
function cpaTitleBlock(ctx, m, x, top, maxW, tS) {
  const lines = m.title === 'COACH' ? ['COACH'] : [m.title.split(' ')[0], 'COACH'];
  lines.forEach((l, i) => {
    const s = cpaFit(ctx, l, maxW, tS, 60, cpaTitle);
    cpaTitleText(ctx, l, x, top + tS * 0.86 + i * tS * 0.9, s, i === lines.length - 1 ? CPA.orange : CPA.white);
  });
  return top + tS * 0.9 * lines.length + 10;
}
// Personnage entier, tête aux pieds, dans le cadre (x, y, w, h), au plus un léger assombrissement uniforme ; aucune
// coupe, aucun masque
function cpaBodyWhole(ctx, body, x, y, w, h) {
  const k = Math.min(w / body.width, h / body.height), bw = body.width * k, bh = body.height * k;
  ctx.globalAlpha = 1 - CPA.bodyDim;
  ctx.drawImage(body, x + (w - bw) / 2, y + (h - bh) / 2, bw, bh);
  ctx.globalAlpha = 1;
}

// Affiche dans le canvas. m : coachPosterModel ; assets : { photo (image d'origine, la plus nette), icon, body
// (cpaHeroBody de la silhouette choisie) } ; format : 'story' (1080 × 1920) ou 'square' (1080 × 1080)
function drawCoachPosterArt(canvas, m, assets = {}, { format = 'story' } = {}) {
  const sq = format === 'square', W = 1080, H = sq ? 1080 : 1920, a = assets;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = CPA.bg; ctx.fillRect(0, 0, W, H);
  if (sq) cpaDrawSquare(ctx, m, a, W, H); else cpaDrawStory(ctx, m, a, W);
  return canvas;
}

// La photo du coach domine (4e panel) : premier élément après le titre, 560 px au moins en story ; le personnage, entier,
// passe second (34 à 38 % de la largeur, à gauche), sans rien posé dessus
const CPA_LEFT = 0.36;

// Story : titre, puis à droite la photo ronde (560 px au moins) et l'identité, à gauche le personnage entier ; dessous,
// sur toute la largeur, le code et la signature. Tout entre 250 et 1600 px (signature au-dessus de la barre de réponse)
function cpaDrawStory(ctx, m, a, W) {
  const left = W * CPA_LEFT, colX = left + 12, colW = W - colX - 40, cx = colX + colW / 2;
  const titleBottom = cpaTitleBlock(ctx, m, W / 2, CPA.safeTop + 6, W - 120, m.title === 'COACH' ? 190 : 140);
  const brand = 46, brandY = 1600 - brand, pill = { h: 150, y: brandY - 16 - 150 };
  const idOpts = { x: cx, maxW: colW, name: [72, 40], subSize: 28, gap: 10 };
  const idH = cpaIdentityDown(ctx, m, { ...idOpts, top: 0, draw: false });
  const photoTop = titleBottom + 24, room = pill.y - 28 - photoTop - idH - 24;
  const d = Math.max(560, Math.min(620, room, colW - 30));
  cpaPhotoRound(ctx, m, a, cx, photoTop, d);
  cpaIdentityDown(ctx, m, { ...idOpts, top: photoTop + d + 36 });
  if (a.body) cpaBodyWhole(ctx, a.body, 16, titleBottom + 20, left - 24, pill.y - 24 - (titleBottom + 20));
  cpaCodePill(ctx, m, W / 2, pill.y, W - 160, pill.h, 26);
  cpaBrand(ctx, a.icon, W / 2, brandY, brand);
}

// Carré : personnage entier à gauche (36 %), colonne de droite : titre, photo (46 % de la largeur), identité, code,
// signature
function cpaDrawSquare(ctx, m, a, W, H) {
  const left = W * CPA_LEFT, colX = left + 12, colW = W - colX - 36, cx = colX + colW / 2;
  if (a.body) cpaBodyWhole(ctx, a.body, 16, 30, left - 24, H - 60);
  const titleBottom = cpaTitleBlock(ctx, m, cx, 26, colW, m.title === 'COACH' ? 120 : 90);
  const brand = 32, brandY = H - 26 - brand, pill = { h: 96, y: brandY - 10 - 96 };
  cpaCodePill(ctx, m, cx, pill.y, colW, pill.h);
  cpaBrand(ctx, a.icon, cx, brandY, brand);
  const idOpts = { x: cx, maxW: colW, name: [58, 34], subSize: 22, gap: 8 };
  const idH = cpaIdentityDown(ctx, m, { ...idOpts, top: 0, draw: false });
  const photoTop = titleBottom + 14;
  const d = Math.max(W * 0.46, Math.min(W * 0.5, pill.y - 16 - photoTop - idH - 16));
  cpaPhotoRound(ctx, m, a, cx, photoTop, d);
  cpaIdentityDown(ctx, m, { ...idOpts, top: photoTop + d + 32 });
}
