// ═══════════════════════════════════════════════════════════
//  Carte des muscles : personnage 3D (face et dos), muscles teintés à l'affichage
// ═══════════════════════════════════════════════════════════
'use strict';

// Images rendues dans Blender (dépôt mdlf-perso, src/export_app.py), dans img/body/<sexe>/<vue>/ :
// base.webp, le corps gris sans couleur, et un calque par muscle visible dans la vue (<id>.webp :
// ombrage du muscle en gris, transparent ailleurs), tous au même cadrage au pixel près. L'app colore
// des combinaisons quelconques (17 muscles × paliers) : on ne pré-rend pas chaque combinaison, on
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
      front: ['chest', 'front_delts', 'side_delts', 'traps', 'biceps', 'brachialis', 'triceps', 'forearms', 'abs', 'quads', 'adductors', 'calves'],
      back:  ['side_delts', 'rear_delts', 'traps', 'lats', 'lower_back', 'triceps', 'forearms', 'glutes', 'hamstrings', 'adductors', 'calves'],
    },
    female: {
      front: ['chest', 'front_delts', 'side_delts', 'traps', 'biceps', 'brachialis', 'triceps', 'forearms', 'abs', 'quads', 'adductors', 'calves'],
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
const bodyPreloaded = [];
function bodyPreload() {
  if (bodyPreloaded.length) return;
  for (const u of bodyImageUrls()) { const i = new Image(); i.decoding = 'async'; i.src = u; bodyPreloaded.push(i); }
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
function bodyViewHtml(kind, view, levels, heat) {
  const color = heat === BODY_COLORS.heat ? '' : `background-color:${esc(heat)};`;
  const layers = BODY_IMG.bodies[kind][view].map(m => {
    const op = bodyHeatOpacity(levels[m]);
    if (!op) return '';
    const url = `url(${bodyImgUrl(kind, view, m)})`;
    return `<i class="body-map__m" data-muscle="${m}" data-heat="${op}" style="${color}background-image:${url};-webkit-mask-image:${url};mask-image:${url};opacity:${op}"></i>`;
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
// Le conteneur prend la largeur que lui donne la feuille de style (ou sa hauteur : premier lancement),
// le rapport largeur / hauteur est fixé par aspect-ratio.
function bodyMapHtml(levels = {}, { view = 'both', body = bodySilhouette(), label = '', className = '', colors = {}, captions = false } = {}) {
  const c = { ...BODY_COLORS, ...colors };
  const views = bodyViews(view);
  const safe = levels && typeof levels === 'object' ? levels : {};
  const kind = bodyKind(body);
  const n = views.length, rowW = n + (n - 1) * BODY_GAP;
  const ratio = `${Math.round(rowW * BODY_IMG.w)} / ${BODY_IMG.h}`;
  const fig = `${Math.round(10000 / rowW) / 100}%`;
  const figs = views.map(v => bodyViewHtml(kind, v, safe, c.heat)).join('');
  const caps = captions ? `<span class="body-map__caps" aria-hidden="true" style="--fig:${fig};color:${esc(c.text)}">${views.map(v => `<span>${v === 'front' ? 'Face' : 'Dos'}</span>`).join('')}</span>` : '';
  const a11y = label ? ` role="img" aria-label="${esc(label)}"` : ' aria-hidden="true"';
  return `<div class="body-map ${esc(className)}" data-body="${kind}"${a11y}><span class="body-map__row" style="aspect-ratio:${ratio};--fig:${fig}">${figs}</span>${caps}</div>`;
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
// colors : { heat, bright } résolus (bodyMapColors()). null si une image manque.
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
      f.drawImage(bodyTintLayer(img, c.heat), 0, 0, w, h);
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
