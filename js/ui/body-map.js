// ═══════════════════════════════════════════════════════════
//  Silhouette musculaire (face et dos) en SVG texte
// ═══════════════════════════════════════════════════════════
'use strict';

// Dessin fait main dans un repère de 100 × 204 (axe du corps en x = 50). Chaque forme est une
// liste de points lissée en courbe fermée (Catmull-Rom convertie en Bézier cubiques) : zones
// arrondies, sans détail anatomique. Les formes latérales sont décrites pour la moitié gauche de
// l'image et recopiées en miroir ; `whole` : forme centrale décrite d'un seul tenant.
// Deux silhouettes (homme, femme ; réglage « Silhouette », bodySilhouette()) : même repère, mêmes
// muscles et mêmes identifiants, seules les proportions changent.

// ── Homme ───────────────────────────────────────────────────

// Peau : parties du corps sans muscle coloriable, superposées (même couleur)
const MALE_SKIN = [
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
const MALE_FRONT = [
  { m: 'traps',       pts: [[44.6, 31.8], [39.6, 34.2], [35.6, 36.4], [40.4, 37.2], [44.6, 36.6]] },
  { m: 'side_delts',  pts: [[28.6, 39.2], [24.4, 42.2], [22.6, 47.6], [22.8, 53.6], [25, 51.4], [27, 45.4], [30, 40.6]] },
  { m: 'front_delts', pts: [[34.6, 38.2], [30.6, 39.8], [28.2, 44.6], [26.8, 51], [28.8, 55], [32, 50.4], [34.8, 42.4]] },
  { m: 'chest',       pts: [[48.8, 40.2], [41, 39.2], [36.2, 40.8], [33.4, 46.8], [33.6, 53.8], [36.8, 58.6], [42.4, 60.6], [48.8, 59.4]] },
  { m: 'biceps',      pts: [[28, 57.4], [24.8, 58.6], [23, 64.6], [22.8, 72.4], [23.8, 78], [25.8, 77.4], [27.8, 71], [29.4, 62.4]] },
  { m: 'brachialis',  pts: [[22.6, 69.8], [21.2, 73.4], [21, 78.6], [22, 81.8], [23.8, 80.4], [23.4, 75.2]] },   // côté externe, sous le biceps
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
const MALE_BACK = [
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

// ── Femme ───────────────────────────────────────────────────
// Même hauteur et même sol que l'homme (les deux se remplacent sans décaler la mise en page) :
// épaules et bras plus fins, taille plus marquée, bassin plus large, cuisses plus rondes.

const FEMALE_SKIN = [
  { whole: true, ellipse: [50, 14.6, 7.4, 9.8] },                                                   // tête
  { whole: true, pts: [[50, 3.6], [44.8, 4.8], [41.8, 9], [41, 15.6], [41, 22], [40.8, 27], [41.8, 29.2],
          [44.2, 28.8], [46.2, 25.6], [47.2, 23], [50, 22.6]] },                                                  // cheveux mi-longs
  { whole: true, pts: [[50, 20], [46.2, 21], [46.1, 28], [45.4, 33.6], [50, 35]] },                   // cou
  { whole: true, pts: [[50, 31], [44.8, 32], [36.6, 35.8], [29.6, 39.2], [27, 44.6], [29.4, 51], [33.2, 56.4],
          [36.4, 70], [35.4, 81], [32.2, 91], [29.9, 101], [29.6, 108], [31.4, 112.8], [40.6, 114.6], [50, 114]] }, // tronc
  { pts: [[30, 39], [25.8, 42.2], [24.2, 50], [23.8, 62], [22.8, 76], [21, 90], [19.2, 103],
          [18.2, 111], [16.8, 117.5], [17.2, 124], [19.8, 126.6], [22.4, 124], [23.4, 117],
          [24.4, 111], [26.8, 98], [29, 86], [30.2, 77], [31.4, 65], [33, 54], [33.8, 45]] },      // bras
  { pts: [[34, 90], [29.6, 104], [29.6, 113], [29.8, 122], [30.4, 134], [32.6, 147], [32.4, 160], [33.6, 175],
          [37, 190.6], [36.4, 197.4], [39.8, 200.4], [45, 200], [45.2, 193.4], [46, 182],
          [46.8, 166], [46.8, 152], [48.2, 137], [49.6, 120], [49.6, 106]] },                       // jambe
];

const FEMALE_ARM = {
  delt:    [[30.4, 39.8], [26.8, 42.6], [25.2, 47.6], [25.2, 52.8], [27.2, 50.8], [28.8, 45.6], [31.6, 41.2]],
  upper:   [[30, 57.6], [27.2, 58.8], [25.6, 64.4], [25.4, 71.6], [26.2, 76.8], [28, 76.2], [29.6, 70.4], [30.8, 62.4]],
  forearm: [[25, 82.6], [22.8, 85.6], [21, 94], [19.6, 103.4], [19.2, 109.4], [22, 110], [23.8, 102], [26.2, 92.6], [27.6, 85]],
};

const FEMALE_FRONT = [
  { m: 'traps',       pts: [[45.2, 32.4], [40.8, 34.8], [37.4, 36.8], [41.2, 37.6], [45, 37]] },
  { m: 'side_delts',  pts: FEMALE_ARM.delt },
  { m: 'front_delts', pts: [[35.6, 38.8], [32.2, 40.4], [30, 45], [28.8, 50.8], [30.6, 54.2], [33.4, 50], [35.8, 42.8]] },
  { m: 'chest',       pts: [[48.6, 41.2], [42, 40.4], [37.6, 41.8], [34.8, 47], [34.8, 53.4], [37.4, 58.4], [41.8, 60.4], [46.2, 59.6], [48.4, 57]] },
  { m: 'biceps',      pts: FEMALE_ARM.upper },
  { m: 'brachialis',  pts: [[24.8, 70.2], [23.6, 73.6], [23.4, 78.4], [24.2, 81.4], [25.8, 80.2], [25.4, 75.2]] },
  { m: 'forearms',    pts: FEMALE_ARM.forearm },
  { m: 'abs',         pts: [[48.8, 64], [43.6, 64.4], [42.4, 69.4], [42.8, 74.6], [48.8, 74.6]] },
  { m: 'abs',         pts: [[48.8, 76.6], [43, 76.6], [43, 86], [48.8, 86]] },
  { m: 'abs',         pts: [[48.8, 88.2], [43.2, 88.2], [43.6, 97.6], [46.2, 103.2], [48.8, 104.4]] },
  { m: 'abs',         pts: [[40, 63.2], [37.6, 66], [38, 73], [37.6, 81], [37.4, 89.6], [40.8, 97.4], [41, 84], [41, 72]] },
  { m: 'quads',       pts: [[39.6, 114], [34.4, 117], [32, 126], [32.8, 137.6], [35.8, 146.4], [40.2, 148], [44.2, 145.4], [45.6, 134.4], [45.2, 122], [43.8, 116.6]] },
  { m: 'adductors',   pts: [[48.8, 116.6], [46.8, 119.6], [46.8, 128], [47.6, 135], [48.8, 129]] },
  { m: 'calves',      pts: [[34.2, 157.4], [33.4, 166.4], [34.8, 177], [36.8, 183.4], [37.4, 173.6], [36.8, 162]] },
  { m: 'calves',      pts: [[46.2, 157.4], [44.4, 162.6], [43.8, 174], [44.6, 182.6], [46, 175], [46.4, 165]] },
];

const FEMALE_BACK = [
  { m: 'traps', whole: true, pts: [[50, 28.2], [46.2, 31.8], [38, 36.8], [35.8, 39], [41, 41.8], [44.6, 50.4], [47.4, 61], [50, 67]] },
  { m: 'side_delts',  pts: FEMALE_ARM.delt },
  { m: 'rear_delts',  pts: [[35, 40.4], [32.2, 40.8], [30, 45], [28.8, 50.8], [30.6, 54.2], [33.4, 50], [35.6, 44.4]] },
  { m: 'lats',        pts: [[40.6, 44.4], [35.6, 46], [34.4, 51.4], [35.2, 58.4], [37.6, 67.6], [41.2, 78], [44.8, 79.6], [45.8, 70], [45.2, 58], [43, 49.4]] },
  { m: 'lower_back', whole: true, pts: [[50, 73], [47.8, 78.8], [43.8, 86], [42.6, 95.4], [44.6, 100.8], [50, 102]] },
  { m: 'triceps',     pts: FEMALE_ARM.upper },
  { m: 'forearms',    pts: FEMALE_ARM.forearm },
  { m: 'glutes',      pts: [[48.8, 103.6], [40.2, 103], [33.6, 107.4], [31.6, 115.6], [34.2, 124], [41, 127.4], [48.8, 124.8]] },
  { m: 'hamstrings',  pts: [[40.2, 130], [34.6, 131.6], [32.4, 138], [33.4, 146.4], [36.4, 152.4], [40.6, 152.4], [45.2, 149.2], [47, 140], [46.2, 132.6]] },
  { m: 'calves',      pts: [[39.6, 155.4], [35.4, 158.4], [33.6, 166], [34.6, 175], [37.6, 181.4], [40.6, 177], [41.6, 166]] },
  { m: 'calves',      pts: [[43, 156], [42.8, 166], [42.8, 176.4], [45, 180.6], [46.2, 170.4], [46.2, 160.4]] },
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
function bodyPaths(skin, front, back) {
  return {
    skin:  skin.flatMap(shapePaths),   // un élément par forme : des sous-chemins superposés s'annuleraient
    front: front.map(s => ({ m: s.m, d: shapePaths(s).join('') })),
    back:  back.map(s => ({ m: s.m, d: shapePaths(s).join('') })),
  };
}
const BODY_PATHS = {
  male:   bodyPaths(MALE_SKIN, MALE_FRONT, MALE_BACK),
  female: bodyPaths(FEMALE_SKIN, FEMALE_FRONT, FEMALE_BACK),
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

// Une vue (face ou dos) d'une silhouette, décalée de dx
function bodyViewSvg(paths, view, levels, colors, dx) {
  const zones = paths[view].map(({ m, d }) => {
    const op = bodyHeatOpacity(levels[m]);
    return op
      ? `<path data-muscle="${m}" d="${d}" fill="${colors.heat}" fill-opacity="${op}"/>`
      : `<path data-muscle="${m}" d="${d}" fill="${colors.zone}"/>`;
  }).join('');
  const skin = paths.skin.map(d => `<path d="${d}"/>`).join('');
  return `<g class="body-map__${view}" transform="translate(${dx} 0)"><g fill="${colors.skin}">${skin}</g>${zones}</g>`;
}

// Silhouette coloriée, en texte SVG. levels : { [id de muscle]: intensité 0..1 } (clés inconnues
// ignorées). Options :
//   view       'front' | 'back' | 'both' (côte à côte, face à gauche)
//   body       'male' | 'female' : silhouette (par défaut le réglage, bodySilhouette())
//   label      texte pour VoiceOver (role="img" + aria-label, voir MDN « ARIA: img role ») ; sans
//              label, le dessin est décoratif (aria-hidden) et l'écran fournit une liste textuelle
//   className  classe(s) ajoutée(s) à <svg>
//   colors     { skin, zone, heat, text } : couleurs CSS (tokens par défaut, voir bodyMapColors())
//   captions   true : « Face » et « Dos » sous les vues
//   width      largeur en px (hauteur déduite) ; sans largeur, le SVG prend celle de son conteneur
//   standalone true : xmlns et dimensions explicites, pour une image ou un canvas
function bodyMapSvg(levels = {}, { view = 'both', body = bodySilhouette(), label = '', className = '', colors = {}, captions = false, width = null, standalone = false } = {}) {
  const c = { ...BODY_COLORS, ...colors };
  const views = view === 'both' ? ['front', 'back'] : [view === 'back' ? 'back' : 'front'];
  const step = BODY_X1 - BODY_X0 + 6;
  const vbW = step * views.length - 6, vbH = BODY_H + (captions ? 14 : 0);
  const safe = levels && typeof levels === 'object' ? levels : {};
  const kind = BODY_PATHS[body] ? body : 'male';
  const svgViews = views.map((v, k) => bodyViewSvg(BODY_PATHS[kind], v, safe, c, k * step)).join('');
  const caps = captions ? views.map((v, k) => `<text x="${BODY_X0 + k * step + (BODY_X1 - BODY_X0) / 2}" y="${BODY_H + 11}" text-anchor="middle" font-size="8" font-family="-apple-system, system-ui, sans-serif" fill="${c.text}">${v === 'front' ? 'Face' : 'Dos'}</text>`).join('') : '';
  const w = width ?? (standalone ? Math.round(vbW * 2) : null);
  const size = w ? ` width="${w}" height="${Math.round(w * vbH / vbW)}"` : '';
  const a11y = label ? ` role="img" aria-label="${esc(label)}"` : ' aria-hidden="true" focusable="false"';
  return `<svg${standalone ? ' xmlns="http://www.w3.org/2000/svg"' : ''} class="body-map ${esc(className)}" data-body="${kind}" viewBox="${BODY_X0} 0 ${vbW} ${vbH}"${size}${a11y}>${svgViews}${caps}</svg>`;
}

// Choix de la silhouette des muscles (Réglages › Affichage, carte du premier lancement de l'accueil) ;
// action set-silhouette dans js/features/settings.js
function silhouetteSegmentedHtml() {
  const cur = bodySilhouette();
  return `<div class="segmented seg-sm" role="group" aria-label="Silhouette de la carte des muscles">
    ${SILHOUETTES.map(([v, l]) => `<button class="segmented__btn ${cur === v ? 'segmented__btn--active' : ''}" aria-pressed="${cur === v}" data-action="set-silhouette" data-val="${v}">${l}</button>`).join('')}
  </div>`;
}
