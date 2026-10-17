// ═══════════════════════════════════════════════════════════
//  Silhouette musculaire (face et dos) en SVG texte
// ═══════════════════════════════════════════════════════════
'use strict';

// Dessin fait main dans un repère de 100 × 204 (axe du corps en x = 50). Chaque forme est une
// liste de points lissée en courbe fermée (Catmull-Rom convertie en Bézier cubiques) : zones
// arrondies, sans détail anatomique. Les formes latérales sont décrites pour la moitié gauche de
// l'image et recopiées en miroir ; `whole` : forme centrale décrite d'un seul tenant.

// Peau : parties du corps sans muscle coloriable, superposées (même couleur)
const BODY_SKIN = [
  { whole: true, ellipse: [50, 14, 8, 10.4] },                                                      // tête
  { whole: true, pts: [[50, 19], [45.6, 20], [45.4, 27], [44.4, 33.4], [50, 35]] },                   // cou
  { whole: true, pts: [[50, 30.5], [44, 31.5], [35, 35.4], [27.4, 38.8], [24.4, 44], [27.5, 51], [32.2, 56],
          [33.8, 70], [34.6, 86], [33.4, 98], [31.6, 108], [41, 113.5], [50, 113]] },             // tronc
  { pts: [[27.6, 38.6], [22.8, 41.8], [21, 50], [20.6, 62], [19.6, 76], [17.6, 90], [15.6, 103],
          [14.6, 111], [13.2, 117.5], [13.8, 124.6], [16.6, 127.6], [19.4, 125], [20.6, 117.4],
          [21.8, 111], [24.4, 98], [26.8, 86], [28, 77], [29.4, 65], [31.4, 54], [32.4, 45]] },    // bras
  { pts: [[33.2, 103], [30.6, 116], [30.6, 132], [32.6, 148], [32, 160], [33, 176], [36.6, 191],
          [35.8, 197.6], [39.4, 200.6], [45.4, 200.2], [45.6, 193.6], [46.2, 182], [47.2, 166],
          [47.2, 152], [48.6, 136], [49.6, 117], [49.6, 106]] },                                   // jambe
];

// Muscles coloriables, vue de face
const BODY_FRONT = [
  { m: 'traps',       pts: [[44.6, 31.8], [39.6, 34.2], [35.6, 36.4], [40.4, 37.2], [44.6, 36.6]] },
  { m: 'side_delts',  pts: [[28.6, 39.2], [24.4, 42.2], [22.6, 47.6], [22.8, 53.6], [25, 51.4], [27, 45.4], [30, 40.6]] },
  { m: 'front_delts', pts: [[34.6, 38.2], [30.6, 39.8], [28.2, 44.6], [26.8, 51], [28.8, 55], [32, 50.4], [34.8, 42.4]] },
  { m: 'chest',       pts: [[48.8, 40.2], [41, 39.2], [36.2, 40.8], [33.4, 46.8], [33.6, 53.8], [36.8, 58.6], [42.4, 60.6], [48.8, 59.4]] },
  { m: 'biceps',      pts: [[28, 57.4], [24.8, 58.6], [23, 64.6], [22.8, 72.4], [23.8, 78], [25.8, 77.4], [27.8, 71], [29.4, 62.4]] },
  { m: 'forearms',    pts: [[22.8, 82.6], [20.6, 85.4], [18.8, 94], [17.2, 103.6], [16.8, 109.6], [19.8, 110.2], [21.8, 102], [24.4, 92.4], [25.8, 85]] },
  { m: 'abs',         pts: [[48.8, 63.4], [43, 63.8], [41.6, 69], [42, 74.6], [48.8, 74.6]] },
  { m: 'abs',         pts: [[48.8, 76.6], [42.2, 76.6], [42.2, 86.2], [48.8, 86.2]] },
  { m: 'abs',         pts: [[48.8, 88.4], [42.4, 88.4], [43, 98.4], [46, 104.2], [48.8, 105.4]] },
  { m: 'abs',         pts: [[39.2, 62.6], [36, 65.6], [36.4, 77], [37, 89.6], [40.4, 97.4], [40.2, 84], [40, 71.6]] },
  { m: 'quads',       pts: [[40.4, 112.6], [35.4, 115.8], [32.6, 125.4], [33.2, 137.4], [36, 146.2], [40.4, 147.6], [44.4, 145], [45.8, 134], [45.4, 121.6], [44.2, 115.4]] },
  { m: 'adductors',   pts: [[48.8, 115], [46.6, 118], [46.8, 127], [47.6, 134.8], [48.8, 128.6]] },
  { m: 'calves',      pts: [[33.8, 157], [33, 166.4], [34.4, 177.2], [36.6, 184], [37.2, 173.8], [36.6, 162]] },
  { m: 'calves',      pts: [[46.6, 157], [44.6, 162.4], [44, 174], [44.8, 183], [46.4, 175], [47, 165]] },
];

// Muscles coloriables, vue de dos
const BODY_BACK = [
  { m: 'traps', whole: true, pts: [[50, 27.4], [45.6, 31], [36.4, 36.4], [34, 38.6], [40.4, 41.6], [44.2, 50.6], [47.4, 62], [50, 68.6]] },
  { m: 'side_delts',  pts: [[28.6, 39.2], [24.4, 42.2], [22.6, 47.6], [22.8, 53.6], [25, 51.4], [27, 45.4], [30, 40.6]] },
  { m: 'rear_delts',  pts: [[33.8, 39.8], [30.6, 40.2], [28.2, 44.6], [26.8, 51], [28.8, 55], [32, 50.4], [34.4, 44]] },
  { m: 'lats',        pts: [[40, 44], [34.6, 45.4], [33, 51], [33.6, 58], [36, 68], [40.6, 79], [44.6, 80.4], [45.6, 70], [45, 58], [42.6, 49]] },
  { m: 'lower_back', whole: true, pts: [[50, 73.4], [47.6, 79.4], [43.4, 86.4], [42.4, 96], [44.6, 101.6], [50, 103]] },
  { m: 'triceps',     pts: [[28, 57.4], [24.8, 58.6], [23, 64.6], [22.8, 72.4], [23.8, 78], [25.8, 77.4], [27.8, 71], [29.4, 62.4]] },
  { m: 'forearms',    pts: [[22.8, 82.6], [20.6, 85.4], [18.8, 94], [17.2, 103.6], [16.8, 109.6], [19.8, 110.2], [21.8, 102], [24.4, 92.4], [25.8, 85]] },
  { m: 'glutes',      pts: [[48.8, 105], [40.6, 104.4], [34.6, 108.8], [32.6, 116.6], [35, 124.4], [41.4, 127.4], [48.8, 124.6]] },
  { m: 'hamstrings',  pts: [[40.4, 129.6], [35, 131.4], [32.8, 138], [33.6, 146.4], [36.6, 152.6], [40.8, 152.4], [45.4, 149.2], [47.2, 140], [46.4, 132.4]] },
  { m: 'calves',      pts: [[39.6, 155], [35.2, 158], [33.2, 166], [34.2, 175], [37.4, 181.8], [40.6, 177], [41.6, 166]] },
  { m: 'calves',      pts: [[43, 155.6], [42.8, 166], [42.8, 176.8], [45.2, 181], [46.8, 170.4], [46.8, 160]] },
];

const BODY_W = 100, BODY_H = 204, BODY_X0 = 11, BODY_X1 = 89;   // cadre utile de chaque vue

const r1 = v => Math.round(v * 10) / 10;
const mirror = pts => pts.map(([x, y]) => [BODY_W - x, y]);

// Courbe fermée passant par tous les points (Catmull-Rom uniforme → Bézier cubiques)
function smoothPath(pts) {
  const n = pts.length, at = i => pts[(i + n) % n];
  let d = `M${r1(pts[0][0])} ${r1(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    d += `C${r1(p1[0] + (p2[0] - p0[0]) / 6)} ${r1(p1[1] + (p2[1] - p0[1]) / 6)} `
       + `${r1(p2[0] - (p3[0] - p1[0]) / 6)} ${r1(p2[1] - (p3[1] - p1[1]) / 6)} ${r1(p2[0])} ${r1(p2[1])}`;
  }
  return d + 'Z';
}

// Forme centrale : moitié gauche (du haut de l'axe au bas de l'axe) complétée par son miroir
function wholePts(half) { return [...half, ...mirror(half).reverse().slice(1, -1)]; }

// Chemins d'une forme (deux pour une forme latérale), calculés une fois
function shapePaths(s) {
  if (s.ellipse) {
    const [cx, cy, rx, ry] = s.ellipse;
    return [`M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0Z`];
  }
  return s.whole ? [smoothPath(wholePts(s.pts))] : [smoothPath(s.pts), smoothPath(mirror(s.pts))];
}
const BODY_PATHS = {
  skin:  BODY_SKIN.flatMap(shapePaths),   // un élément par forme : des sous-chemins superposés s'annuleraient
  front: BODY_FRONT.map(s => ({ m: s.m, d: shapePaths(s).join('') })),
  back:  BODY_BACK.map(s => ({ m: s.m, d: shapePaths(s).join('') })),
};

// Opacité de la couleur de chaleur pour une intensité 0..1 (0 : couleur neutre des muscles)
function bodyHeatOpacity(i) {
  const v = Math.max(0, Math.min(1, Number(i) || 0));
  return v > 0 ? r1(0.15 + 0.85 * v) : 0;
}

const BODY_COLORS = { skin: 'var(--body-skin)', zone: 'var(--body-zone)', heat: 'var(--body-heat)', text: 'var(--label2)' };

// Couleurs résolues depuis les tokens du thème affiché : pour un SVG autonome (image, canvas),
// où var(--x) n'a pas de sens
function bodyMapColors(el = document.body) {
  const cs = getComputedStyle(el);
  const get = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
  return { skin: get('--body-skin', '#2C2C2E'), zone: get('--body-zone', '#48484A'),
           heat: get('--body-heat', '#FF9F0A'), text: get('--label2', '#8E8E93') };
}

// Une vue (face ou dos) décalée de dx
function bodyViewSvg(view, levels, colors, dx) {
  const zones = BODY_PATHS[view].map(({ m, d }) => {
    const op = bodyHeatOpacity(levels[m]);
    return op
      ? `<path data-muscle="${m}" d="${d}" fill="${colors.heat}" fill-opacity="${op}"/>`
      : `<path data-muscle="${m}" d="${d}" fill="${colors.zone}"/>`;
  }).join('');
  const skin = BODY_PATHS.skin.map(d => `<path d="${d}"/>`).join('');
  return `<g class="body-map__${view}" transform="translate(${dx} 0)"><g fill="${colors.skin}">${skin}</g>${zones}</g>`;
}

// Silhouette coloriée, en texte SVG. levels : { [id de muscle]: intensité 0..1 } (clés inconnues
// ignorées). Options :
//   view       'front' | 'back' | 'both' (côte à côte, face à gauche)
//   label      texte pour VoiceOver (role="img" + aria-label, voir MDN « ARIA: img role ») ; sans
//              label, le dessin est décoratif (aria-hidden) et l'écran fournit une liste textuelle
//   className  classe(s) ajoutée(s) à <svg>
//   colors     { skin, zone, heat, text } : couleurs CSS (tokens par défaut, voir bodyMapColors())
//   captions   true : « Face » et « Dos » sous les vues
//   width      largeur en px (hauteur déduite) ; sans largeur, le SVG prend celle de son conteneur
//   standalone true : xmlns et dimensions explicites, pour une image ou un canvas
function bodyMapSvg(levels = {}, { view = 'both', label = '', className = '', colors = {}, captions = false, width = null, standalone = false } = {}) {
  const c = { ...BODY_COLORS, ...colors };
  const views = view === 'both' ? ['front', 'back'] : [view === 'back' ? 'back' : 'front'];
  const step = BODY_X1 - BODY_X0 + 6;
  const vbW = step * views.length - 6, vbH = BODY_H + (captions ? 14 : 0);
  const safe = levels && typeof levels === 'object' ? levels : {};
  const body = views.map((v, k) => bodyViewSvg(v, safe, c, k * step)).join('');
  const caps = captions ? views.map((v, k) => `<text x="${BODY_X0 + k * step + (BODY_X1 - BODY_X0) / 2}" y="${BODY_H + 11}" text-anchor="middle" font-size="8" font-family="-apple-system, system-ui, sans-serif" fill="${c.text}">${v === 'front' ? 'Face' : 'Dos'}</text>`).join('') : '';
  const w = width ?? (standalone ? Math.round(vbW * 2) : null);
  const size = w ? ` width="${w}" height="${Math.round(w * vbH / vbW)}"` : '';
  const a11y = label ? ` role="img" aria-label="${esc(label)}"` : ' aria-hidden="true" focusable="false"';
  return `<svg${standalone ? ' xmlns="http://www.w3.org/2000/svg"' : ''} class="body-map ${esc(className)}" viewBox="${BODY_X0} 0 ${vbW} ${vbH}"${size}${a11y}>${body}${caps}</svg>`;
}
