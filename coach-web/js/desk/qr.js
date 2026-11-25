// ═══════════════════════════════════════════════════════════
//  MDLF Coach sur ordinateur : QR code de « Relier cet ordinateur » (docs/PHOTOS_WEB.md). Logique pure, sans DOM.
//
//  Pourquoi un encodeur maison : la CSP n'autorise aucun script tiers après la connexion, et une bibliothèque de plus
//  serait une dépendance à suivre pour une page qui tient des clés. Le besoin est étroit : texte ASCII de ~160
//  caractères, mode octet, correction M, versions 1 à 10. Méthode : norme ISO/IEC 18004 (placement, Reed-Solomon dans
//  GF(256) de polynôme 0x11D, informations de format et de version en BCH), dans la forme du générateur de Nayuki
//  (« QR Code generator library », MIT). Vérifié par tests/unit/photo-link.mjs (structure, format, version) et par
//  OpenCV qui relit le QR affiché dans les trois moteurs (tests/test_photos_web.py).
// ═══════════════════════════════════════════════════════════
'use strict';

// Correction M, versions 1 à 10 : [codes de correction par bloc, [nombre de blocs, octets de données par bloc]…]
const DESK_QR_M = [null,
  [10, [1, 16]], [16, [1, 28]], [26, [1, 44]], [18, [2, 32]], [24, [2, 43]],
  [16, [4, 27]], [18, [4, 31]], [22, [2, 38], [2, 39]], [22, [3, 36], [2, 37]], [26, [4, 43], [1, 44]]];
const DESK_QR_ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

function deskQrGfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; }
  return z & 0xFF;
}
function deskQrDivisor(degree) {
  const r = new Array(degree).fill(0);
  r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < r.length; j++) { r[j] = deskQrGfMul(r[j], root); if (j + 1 < r.length) r[j] ^= r[j + 1]; }
    root = deskQrGfMul(root, 0x02);
  }
  return r;
}
function deskQrRemainder(data, div) {
  const r = new Array(div.length).fill(0);
  for (const b of data) {
    const f = b ^ r.shift();
    r.push(0);
    div.forEach((c, i) => { r[i] ^= deskQrGfMul(c, f); });
  }
  return r;
}
const deskQrDataBytes = v => DESK_QR_M[v].slice(1).reduce((a, [n, k]) => a + n * k, 0);

// Octets → mots de code entrelacés (données puis correction) de la plus petite version qui les contient, ou null
function deskQrCodewords(bytes) {
  let v = 1;
  while (v <= 10 && 4 + (v < 10 ? 8 : 16) + bytes.length * 8 > deskQrDataBytes(v) * 8) v++;
  if (v > 10) return null;
  const cap = deskQrDataBytes(v) * 8, bits = [];
  const put = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(0b0100, 4); put(bytes.length, v < 10 ? 8 : 16);
  bytes.forEach(b => put(b, 8));
  put(0, Math.min(4, cap - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xEC; bits.length < cap; pad ^= 0xEC ^ 0x11) put(pad, 8);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  const [ecLen, ...groups] = DESK_QR_M[v], div = deskQrDivisor(ecLen), blocks = [];
  let k = 0;
  groups.forEach(([n, len]) => { for (let i = 0; i < n; i++) { const d = data.slice(k, k + len); k += len; blocks.push({ d, e: deskQrRemainder(d, div) }); } });
  const out = [], maxLen = Math.max(...blocks.map(b => b.d.length));
  for (let i = 0; i < maxLen; i++) blocks.forEach(b => { if (i < b.d.length) out.push(b.d[i]); });
  for (let i = 0; i < ecLen; i++) blocks.forEach(b => out.push(b.e[i]));
  return { version: v, codewords: out };
}

const DESK_QR_MASKS = [
  (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, x => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
  (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0, (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0];

// Bits du format (correction M = 00, masque) : 15 bits, BCH(15,5) de polynôme 0x537, XOR 0x5412
function deskQrFormatBits(mask) {
  const data = (0b00 << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}
// Bits de version (7 et plus) : 18 bits, BCH(18,6) de polynôme 0x1F25
function deskQrVersionBits(v) {
  let rem = v;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
  return (v << 12) | rem;
}

function deskQrBuild(version, codewords, mask) {
  const size = version * 4 + 17;
  const m = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, dark) => { m[y][x] = dark; fn[y][x] = true; };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
      if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  const al = DESK_QR_ALIGN[version], last = al.length - 1;
  al.forEach((cy, i) => al.forEach((cx, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));
  const format = f => {
    const bit = i => ((f >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);   // module toujours sombre
  };
  format(0);   // réserve les places (bits réels posés après le masque)
  if (version >= 7) {
    const vb = deskQrVersionBits(version);
    for (let i = 0; i < 18; i++) { const bit = ((vb >>> i) & 1) === 1, a = size - 11 + (i % 3), b = Math.floor(i / 3); set(a, b, bit); set(b, a, bit); }
  }
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
      if (!fn[y][x] && i < codewords.length * 8) { m[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1; i++; }
    }
  }
  const mk = DESK_QR_MASKS[mask];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && mk(x, y)) m[y][x] = !m[y][x];
  format(deskQrFormatBits(mask));
  return m;
}

// Pénalité de la norme (séries, carrés 2×2, motifs de repère, équilibre) : choisit le masque le plus lisible
function deskQrPenalty(m) {
  const n = m.length;
  let p = 0, dark = 0;
  const lines = [];
  for (let y = 0; y < n; y++) { lines.push(m[y]); lines.push(m.map(r => r[y])); }
  const pat = [true, false, true, true, true, false, true];
  for (const l of lines) {
    let run = 1;
    for (let i = 1; i <= n; i++) {
      if (i < n && l[i] === l[i - 1]) run++;
      else { if (run >= 5) p += 3 + run - 5; run = 1; }
    }
    for (let i = 0; i + 7 <= n; i++) {
      if (!pat.every((v, k) => l[i + k] === v)) continue;
      const before = i >= 4 && [1, 2, 3, 4].every(k => !l[i - k]), after = i + 11 <= n && [7, 8, 9, 10].every(k => !l[i + k]);
      if (before || after) p += 40;
    }
  }
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (m[y][x]) dark++;
    if (x < n - 1 && y < n - 1 && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3;
  }
  return p + 10 * Math.floor(Math.abs(dark * 100 / (n * n) - 50) / 5);
}

// Texte → matrice (lignes de booléens, vrai = sombre), ou null s'il ne tient pas en version 10
function deskQrMatrix(text) {
  const cw = deskQrCodewords(new TextEncoder().encode(String(text)));
  if (!cw) return null;
  let best = null, bestP = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const m = deskQrBuild(cw.version, cw.codewords, mask), p = deskQrPenalty(m);
    if (p < bestP) { best = m; bestP = p; }
  }
  return best;
}

// Matrice → SVG (modules sombres en un seul tracé, marge de 4 modules, toujours noir sur blanc : lisible en sombre aussi)
function deskQrSvg(text, label) {
  const m = deskQrMatrix(text);
  if (!m) return '';
  const n = m.length, q = 4, d = [];
  m.forEach((row, y) => row.forEach((on, x) => { if (on) d.push(`M${x + q} ${y + q}h1v1h-1z`); }));
  return `<svg class="qr" viewBox="0 0 ${n + 2 * q} ${n + 2 * q}" role="img" aria-label="${esc(label)}" shape-rendering="crispEdges"><rect class="qr-bg" width="${n + 2 * q}" height="${n + 2 * q}"/><path class="qr-fg" d="${d.join('')}"/></svg>`;
}
