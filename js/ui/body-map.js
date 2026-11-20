// ═══════════════════════════════════════════════════════════
//  Carte des muscles : personnage 3D (face et dos), muscles teintés à l'affichage
// ═══════════════════════════════════════════════════════════
'use strict';

// Images rendues dans Blender (dépôt mdlf-perso, src/export_app.py), dans img/body/<sexe>/<vue>/ :
// base.webp, le corps gris sans couleur, et un calque par muscle visible dans la vue (<id>.webp :
// ombrage du muscle en gris, transparent ailleurs), tous au même cadrage au pixel près. L'app colore
// des combinaisons quelconques (18 muscles × paliers) : on ne pré-rend pas chaque combinaison, on
// pose sur la base, pour chaque muscle travaillé, sa couleur multipliée par son calque.
//
// Composition en CSS (un élément par muscle coloré, aucun script après l'affichage) :
//   background-color (couleur) × background-image (calque gris)  -> background-blend-mode: multiply
//   mask-image (le même calque, son alpha)                       -> limité à la forme du muscle
//   opacity                                                      -> palier (bodyHeatOpacity)
// Le rouge ou l'orange garde le modelé du calque (sombre dans les creux, clair sur les bombés).
// Choisi plutôt qu'un canvas : rendu par le compositeur de WebKit, sans attendre le chargement des
// images en JavaScript ni redessiner au changement de thème ; le texte HTML reste testable. La même
// image sert de fond et de masque : un seul téléchargement. Le canvas ne sert qu'à l'image partagée
// (bodyMapImage), où un dessin hors page est de toute façon nécessaire.

// Tailles et muscles présents par vue : copie de out/app/manifest.json (mdlf-perso, export_app.py)
const BODY_IMG = {
  w: 388, h: 840,
  bodies: {
    male: {
      front: ['chest', 'front_delts', 'side_delts', 'traps', 'biceps', 'brachialis', 'triceps', 'forearms', 'abs', 'obliques', 'quads', 'adductors', 'calves'],
      back:  ['side_delts', 'rear_delts', 'traps', 'lats', 'lower_back', 'triceps', 'forearms', 'glutes', 'hamstrings', 'adductors', 'calves'],
    },
    female: {
      front: ['chest', 'front_delts', 'side_delts', 'traps', 'biceps', 'brachialis', 'triceps', 'forearms', 'abs', 'obliques', 'quads', 'adductors', 'calves'],
      back:  ['side_delts', 'rear_delts', 'traps', 'lats', 'lower_back', 'triceps', 'forearms', 'glutes', 'hamstrings', 'adductors', 'calves'],
    },
  },
};
const BODY_DIR = 'img/body';
const BODY_GAP = 0.08;   // écart entre la face et le dos, en largeur d'une vue

function bodyImgUrl(kind, view, name) { return `${BODY_DIR}/${kind}/${view}/${name}.webp`; }

// Toutes les images (sw.js : cache hors ligne)
function bodyImageUrls() {
  return Object.entries(BODY_IMG.bodies).flatMap(([kind, views]) => Object.entries(views).flatMap(([view, ms]) =>
    ['base', ...ms].map(n => bodyImgUrl(kind, view, n))));
}

// Calques chargés d'avance, quand la page est au repos (≈ 310 Ko, fichiers locaux) : sinon un muscle
// pouvait apparaître sans couleur le temps que son masque CSS se charge, au premier affichage d'une carte.
// Plus les deux bases 1× de l'atlas du personnage choisi (≈ 60 Ko, fiche exercice : bodyAtlasHtml) : la fiche
// s'ouvre avec son personnage déjà là, sans charger plus d'images qu'avant l'atlas (tests/test_atlas.py)
const bodyPreloaded = [];
function bodyPreload() {
  if (bodyPreloaded.length) return;
  const atlas = ['front', 'back'].map(v => `${BODY2_DIR}/${bodyKind(bodySilhouette())}/${v}/base.webp`);
  for (const u of [...bodyImageUrls(), ...atlas]) { const i = new Image(); i.decoding = 'async'; i.src = u; bodyPreloaded.push(i); }
}
if (typeof window !== 'undefined' && typeof document !== 'undefined' && document.readyState) {
  const idle = window.requestIdleCallback || (f => setTimeout(f, 300));
  window.addEventListener('load', () => idle(bodyPreload), { once: true });
}

// Opacité de la couleur de chaleur pour une intensité 0..1 (0 : muscle non coloré)
function bodyHeatOpacity(i) {
  const v = Math.max(0, Math.min(1, Number(i) || 0));
  return v > 0 ? Math.round((0.15 + 0.85 * v) * 10) / 10 : 0;
}

// Paliers de Progrès (option tiers) : une rampe rouge dont la clarté change dans le même sens à chaque palier (panels de
// la vague 3 : Objectif atteint plus clair que Gros volume, l'échelle ne se lisait pas). En clair, du plus pâle au plus
// sombre ; en sombre, du plus sombre au plus lumineux (tokens --body-tier-1 à 4, css/base.css). Intensité = palier /
// MUSCLE_LEVEL_MAX ; null : muscle non coloré.
function bodyTier(i) {
  const v = Math.max(0, Math.min(1, Number(i) || 0));
  if (!v) return null;
  return { tone: `t${Math.min(4, Math.max(1, Math.round(v * 4)))}`, op: 1 };
}

const BODY_COLORS = { heat: 'var(--body-heat)', text: 'var(--label2)' };

// Couleurs résolues depuis les tokens du thème affiché : pour l'image partagée (canvas), où var(--x)
// n'a pas de sens. bright : luminosité de la base (sombre : corps assombri sur le noir)
function bodyMapColors(el = document.body) {
  const cs = getComputedStyle(el);
  const get = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
  return { heat: get('--body-heat', '#FF9F0A'), text: get('--label2', '#8E8E93'),
           bright: parseFloat(get('--body-base-bright', '1')) || 1 };
}

function bodyKind(body) { return BODY_IMG.bodies[body] ? body : 'male'; }
function bodyViews(view) { return view === 'both' ? ['front', 'back'] : [view === 'back' ? 'back' : 'front']; }

// Une vue : base, puis un calque teinté par muscle coloré (rien pour un muscle au repos)
// secondary : muscles dessinés dans la couleur des secondaires (--body-heat-sec), au lieu de la chaleur
// peak : muscles à l'intensité 1 dans la teinte du palier le plus haut (--body-heat-max, récaps)
// tiers : teinte et opacité de chaque palier (bodyTier : carte « Muscles » de Progrès)
function bodyViewHtml(kind, view, levels, heat, secondary = [], peak = false, tiers = false) {
  const color = heat === BODY_COLORS.heat ? '' : `background-color:${esc(heat)};`;
  const layers = BODY_IMG.bodies[kind][view].map(m => {
    const tier = tiers ? bodyTier(levels[m]) : null;
    const op = tier ? tier.op : bodyHeatOpacity(levels[m]);
    if (!op) return '';
    const url = `url(${bodyImgUrl(kind, view, m)})`;
    const sec = secondary.includes(m), top = !sec && !tier && peak && levels[m] >= 1;
    const low = !sec && tier ? tier.tone : '';
    return `<i class="body-map__m${sec ? ' body-map__m--sec' : ''}${top ? ' body-map__m--peak' : ''}${low ? ` body-map__m--${low}` : ''}" data-muscle="${m}" data-heat="${op}" style="${sec || low ? '' : color}background-image:${url};-webkit-mask-image:${url};mask-image:${url};opacity:${op}"></i>`;
  }).join('');
  return `<span class="body-map__fig body-map__${view}"><img class="body-map__base" src="${bodyImgUrl(kind, view, 'base')}" alt="" draggable="false" decoding="async">${layers}</span>`;
}

// Carte des muscles, en texte HTML. levels : { [id de muscle]: intensité 0..1 } (clés inconnues
// ignorées). Options :
//   view       'front' | 'back' | 'both' (côte à côte, face à gauche)
//   body       'male' | 'female' : personnage (par défaut le réglage, bodySilhouette())
//   label      texte pour VoiceOver (role="img" + aria-label, voir MDN « ARIA: img role ») ; sans
//              label, le dessin est décoratif (aria-hidden) et l'écran fournit une liste textuelle
//   className  classe(s) ajoutée(s) au conteneur
//   colors     { heat, text } : couleurs CSS (tokens par défaut)
//   captions   true : « Face » et « Dos » sous les vues
//   secondary  identifiants des muscles secondaires (fiche exercice) : autre teinte (--body-heat-sec)
//   peak       true : muscles à l'intensité 1 dans la teinte du palier le plus haut (--body-heat-max)
//   tiers      true : une teinte par palier (bodyTier), au lieu d'opacités d'une seule teinte
//   tap        true : un toucher sur un muscle ouvre une bulle (action body-tap, js/features/muscle-tip.js)
// Le conteneur prend la largeur que lui donne la feuille de style (ou sa hauteur : premier lancement),
// le rapport largeur / hauteur est fixé par aspect-ratio.
function bodyMapHtml(levels = {}, { view = 'both', body = bodySilhouette(), label = '', className = '', colors = {}, captions = false, secondary = [], peak = false, tiers = false, tap = false } = {}) {
  const c = { ...BODY_COLORS, ...colors };
  const views = bodyViews(view);
  const safe = levels && typeof levels === 'object' ? levels : {};
  const kind = bodyKind(body);
  const n = views.length, rowW = n + (n - 1) * BODY_GAP;
  const ratio = `${Math.round(rowW * BODY_IMG.w)} / ${BODY_IMG.h}`;
  const fig = `${Math.round(10000 / rowW) / 100}%`;
  const sec = Array.isArray(secondary) ? secondary : [];
  const figs = views.map(v => bodyViewHtml(kind, v, safe, c.heat, sec, peak, tiers)).join('');
  const caps = captions ? `<span class="body-map__caps" aria-hidden="true" style="--fig:${fig};color:${esc(c.text)}">${views.map(v => `<span>${v === 'front' ? 'Face' : 'Dos'}</span>`).join('')}</span>` : '';
  const a11y = label ? ` role="img" aria-label="${esc(label)}"` : ' aria-hidden="true"';
  const act = tap ? ' data-action="body-tap"' : '';
  return `<div class="body-map ${esc(className)}" data-body="${kind}"${act}${a11y}><span class="body-map__row" style="aspect-ratio:${ratio};--body-ar:${(rowW * BODY_IMG.w / BODY_IMG.h).toFixed(4)};--fig:${fig}">${figs}</span>${caps}</div>`;
}

// ── Atlas détaillé (fiche exercice de la bibliothèque) ──────

// Sous-muscles au lieu des 18 muscles, d'après BODY_PARTS (js/data/body-parts.js, img/body2/) : même composition
// CSS (couleur × calque, masque = alpha du calque), mais chaque calque est RECADRÉ sur son sous-muscle et posé à
// sa boîte (en % de la vue). Rendu propre de l'atlas : ses images ne se mêlent jamais à celles de img/body (autre
// rendu du personnage, autre cadrage). Le 1× s'affiche ici ; le 3× ne se charge qu'au zoom (js/ui/body-zoom.js).
const BODY2_DIR = 'img/body2';
const BODY_PART_SEC_OPACITY = 0.45;   // rouge atténué nettement plus pâle que le plein (panel atlas t1 : à 0,8 il se lisait comme le plein ; mesuré
                                      // le 20/11 : contraste plein / atténué ≈ 2,1:1 en clair, 1,5:1 en sombre, contre 1,6 et 1,4 à 0,8)
const BODY_PART_DEEP_OPACITY = 0.6;   // profond, vu « à travers » le muscle qui le couvre (convention des planches)

function body2Url(kind, view, file) { return `${BODY2_DIR}/${kind}/${view}/${file}`; }

// Calques d'une vue de l'atlas. levels : { id de sous-muscle: 2|1 } ; res : 1 ou 3 (p/ ou p3/).
// Ordre : superficiels dans l'ordre de BODY_PARTS, puis les profonds par-dessus, en transparence.
function bodyAtlasLayersHtml(kind, view, levels, res = 1) {
  const boxes = BODY_PARTS.boxes[kind]?.[view] || {};
  const W = res === 3 ? BODY_PARTS.w3 : BODY_PARTS.w, H = res === 3 ? BODY_PARTS.h3 : BODY_PARTS.h;
  const pct = v => `${Math.round(v * 1e5) / 1e3}%`;
  const on = BODY_PARTS.parts.filter(p => boxes[p.id] && levels[p.id] > 0);
  on.sort((a, b) => Number(!!a.deep) - Number(!!b.deep));
  return on.map(p => {
    const b = boxes[p.id][res === 3 ? 1 : 0], lv = levels[p.id];
    const url = `url(${body2Url(kind, view, `${res === 3 ? 'p3' : 'p'}/${p.id}.webp`)})`;
    const op = p.deep ? BODY_PART_DEEP_OPACITY : lv >= 2 ? 1 : BODY_PART_SEC_OPACITY;
    const cls = `body-map__m body-map__p${lv >= 2 ? '' : ' body-map__m--sec'}${p.deep ? ' body-map__p--deep' : ''}`;
    return `<i class="${cls}" data-part="${p.id}" data-muscle="${p.parent || ''}" data-level="${lv}" style="left:${pct(b[0] / W)};top:${pct(b[1] / H)};width:${pct((b[2] - b[0]) / W)};height:${pct((b[3] - b[1]) / H)};background-image:${url};-webkit-mask-image:${url};mask-image:${url};opacity:${op}"></i>`;
  }).join('');
}

// Carte de l'atlas, face et dos côte à côte, en texte HTML (même gabarit que bodyMapHtml : .body-map__row,
// .body-map__fig, d'où les mêmes places de bulle). levels : exercisePartLevels(…).levels (js/data/atlas.js).
// Options : body (personnage), className, title (nom de l'exercice, titre de la vue agrandie), tap (bulle
// du sous-muscle touché, zoom au double toucher ou au pincement : js/ui/body-zoom.js)
function bodyAtlasHtml(levels = {}, { body = bodySilhouette(), className = '', title = '', tap = false } = {}) {
  const kind = bodyKind(body), safe = levels && typeof levels === 'object' ? levels : {};
  const rowW = 2 + BODY_GAP, fig = `${Math.round(10000 / rowW) / 100}%`;
  const [y0, y1] = bodyAtlasCrop(kind, safe), ch = y1 - y0;
  const inner = `top:${Math.round(-y0 / ch * 1e5) / 1e3}%;height:${Math.round(BODY_PARTS.h / ch * 1e5) / 1e3}%`;
  const figs = ['front', 'back'].map(v => `<span class="body-map__fig body-map__${v}"><span class="body-map__body" style="${inner}"><img class="body-map__base" src="${body2Url(kind, v, 'base.webp')}" alt="" draggable="false" decoding="async">${bodyAtlasLayersHtml(kind, v, safe)}</span></span>`).join('');
  const act = tap ? ' data-action="body-tap"' : '';
  const crop = ch < BODY_PARTS.h ? ' body-map--crop' : '';
  return `<div class="body-map body-map--atlas${crop} ${esc(className)}" data-body="${kind}" data-atlas="${esc(JSON.stringify(safe))}" data-crop="${y0},${y1}" data-title="${esc(title)}"${act} aria-hidden="true"><span class="body-map__row" style="aspect-ratio:${Math.round(rowW * BODY_PARTS.w)} / ${ch};--body-ar:${(rowW * BODY_PARTS.w / ch).toFixed(4)};--fig:${fig}">${figs}</span></div>`;
}

// Cadrage de la carte de la fiche, en points 1× de la vue : [haut, bas]. Muscles travaillés tous dans le haut du
// corps : de la tête à la taille, le personnage paraît plus grand ; tous dans le bas (fessiers, jambes) : de la taille
// aux pieds ; sinon le corps entier. Le cadre contient chaque sous-muscle coloré (tests/unit/atlas.mjs).
const BODY_ATLAS_UPPER = [0, 450];    // tête → taille (abdominaux et obliques compris)
const BODY_ATLAS_LOWER = [330, 840];  // taille → pieds (fessiers compris)
const BODY_ATLAS_LEGS = new Set(['glutes', 'quads', 'hamstrings', 'adductors', 'calves']);
const BODY_ATLAS_LEGS_OWN = new Set(['tfl', 'sartorius', 'tibialis', 'peroneus']);   // sans muscle parent
function bodyAtlasCrop(kind, levels) {
  const on = BODY_PARTS.parts.filter(p => levels[p.id] > 0 && ['front', 'back'].some(v => BODY_PARTS.boxes[kind]?.[v]?.[p.id]));
  if (!on.length) return [0, BODY_PARTS.h];
  const legs = p => BODY_ATLAS_LEGS.has(p.parent) || BODY_ATLAS_LEGS_OWN.has(p.id);
  const fits = ([y0, y1]) => on.every(p => ['front', 'back'].every(v => {
    const b = BODY_PARTS.boxes[kind]?.[v]?.[p.id];
    return !b || (b[0][1] >= y0 && b[0][3] <= y1);
  }));
  if (!on.some(legs) && fits(BODY_ATLAS_UPPER)) return BODY_ATLAS_UPPER;
  if (on.every(legs) && fits(BODY_ATLAS_LOWER)) return BODY_ATLAS_LOWER;
  return [0, BODY_PARTS.h];
}

// ── Image partagée (canvas) ─────────────────────────────────

const bodyImageCache = new Map();
function bodyLoadImage(src) {
  if (!bodyImageCache.has(src)) {
    bodyImageCache.set(src, new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => { bodyImageCache.delete(src); resolve(null); };
      img.src = src;
    }));
  }
  return bodyImageCache.get(src);
}

// Calque d'un muscle teinté : couleur × gris du calque (multiply), puis découpé par son alpha
function bodyTintLayer(img, heat) {
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const x = c.getContext('2d');
  x.drawImage(img, 0, 0);
  x.globalCompositeOperation = 'multiply';
  x.fillStyle = heat; x.fillRect(0, 0, c.width, c.height);
  x.globalCompositeOperation = 'destination-in';
  x.drawImage(img, 0, 0);
  return c;
}

// Même carte dans un canvas (face et dos côte à côte, sans légende), pour l'image partagée.
// colors : { heat, bright, peak? } résolus (bodyMapColors()) ; peak : teinte des muscles à l'intensité 1
// (palier le plus haut, comme peak de bodyMapHtml). null si une image manque.
async function bodyMapImage(levels = {}, { view = 'both', body = bodySilhouette(), colors = {} } = {}) {
  const c = { ...bodyMapColors(), ...colors };
  const kind = bodyKind(body), views = bodyViews(view);
  const { w, h } = BODY_IMG, gap = Math.round(w * BODY_GAP);
  const canvas = document.createElement('canvas');
  canvas.width = views.length * w + (views.length - 1) * gap; canvas.height = h;
  const ctx = canvas.getContext('2d');
  for (const [k, v] of views.entries()) {
    const dx = k * (w + gap);
    const base = await bodyLoadImage(bodyImgUrl(kind, v, 'base'));
    if (!base) return null;
    const fig = document.createElement('canvas');
    fig.width = w; fig.height = h;
    const f = fig.getContext('2d');
    f.drawImage(base, 0, 0, w, h);
    if (c.bright < 1) {   // thème sombre : base assombrie comme filter: brightness() en CSS
      f.globalCompositeOperation = 'source-atop';
      f.fillStyle = `rgba(0,0,0,${1 - c.bright})`; f.fillRect(0, 0, w, h);
      f.globalCompositeOperation = 'source-over';
    }
    for (const m of BODY_IMG.bodies[kind][v]) {
      const op = bodyHeatOpacity(levels?.[m]);
      if (!op) continue;
      const img = await bodyLoadImage(bodyImgUrl(kind, v, m));
      if (!img) return null;
      f.globalAlpha = op;
      f.drawImage(bodyTintLayer(img, c.peak && levels[m] >= 1 ? c.peak : c.heat), 0, 0, w, h);
      f.globalAlpha = 1;
    }
    ctx.drawImage(fig, dx, 0);
  }
  return canvas;
}

// Choix de la silhouette des muscles (Réglages › Affichage) ; action set-silhouette dans js/features/settings.js
// (premier lancement : les personnages eux-mêmes, js/features/onboarding.js)
function silhouetteSegmentedHtml() {
  const cur = bodySilhouette();
  return `<div class="segmented seg-sm" role="group" aria-label="Silhouette de la carte des muscles">
    ${SILHOUETTES.map(([v, l]) => `<button class="segmented__btn ${cur === v ? 'segmented__btn--active' : ''}" aria-pressed="${cur === v}" data-action="set-silhouette" data-val="${v}">${l}</button>`).join('')}
  </div>`;
}
