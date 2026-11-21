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
// Panel affichage-e t1 (38 juges sur 40) : l'échelle s'inversait entre les thèmes. Désormais UNE échelle : le rouge des
// muscles (--body-heat) de plus en plus opaque, donc de plus en plus intense, du palier 1 au palier 4, dans les deux thèmes ;
// « pas travaillé » reste le gris du corps. Même code que la fiche : rouge = travaillé, plus intense = plus travaillé.
// Panels affichage-e t3 et t4 : 4 puis 3 paliers de rouge se ressemblaient. Désormais 3 états en tout : le gris du corps
// (pas travaillé, aucun calque), « Sous l'objectif » en rouge pâle et « Objectif atteint » dans le rouge plein de la fiche
// (jetons --body-tier-1 et 2, theme-sobre-progres.css). Écarts mesurés sur le personnage (test_panel_apple) : 25 au moins
// entre le gris et le pâle, 35 au moins entre le pâle et le plein. op : opacité du calque (pleine).
const BODY_TIERS = 2;
function bodyTier(i) {
  const v = Math.max(0, Math.min(1, Number(i) || 0));
  if (!v) return null;
  const n = Math.min(BODY_TIERS, Math.max(1, Math.round(v * BODY_TIERS)));
  return { tone: `t${n}`, op: 1 };
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
// Muscles qui aident : opacité du jeton --body-sec-o (clair : le rouge à 50 % ; sombre : un rose éteint opaque, css/muscles.css ;
// panels affichage-e t3 et t5 : à 35 %, presque invisibles ; éclairés, presque aussi vifs que le ciblé) ; le ciblé, rouge plein, se voit en premier
const BODY_PART_SEC_OPACITY = 'var(--body-sec-o)';
const BODY_PART_DEEP_OPACITY = 0.6;   // profond, vu « à travers » le muscle qui le couvre (convention des planches)

function body2Url(kind, view, file) { return `${BODY2_DIR}/${kind}/${view}/${file}`; }

// Calques d'une vue de l'atlas. levels : { id de sous-muscle: 2|1 } ; res : 1 ou 3 (p/ ou p3/).
// Ordre : superficiels dans l'ordre de BODY_PARTS, puis les profonds par-dessus, en transparence.
// tiers : levels = paliers de Progrès (1..2, bodyTier) au lieu de plein / qui aide
// outline : sous-muscles cernés d'un contour net (Progrès : les muscles à 0 série de « À travailler », sinon de la couleur
// du corps, invisibles ; panel affichage-e t6), par-dessus les calques
function bodyAtlasLayersHtml(kind, view, levels, res = 1, tiers = false, outline = []) {
  const boxes = BODY_PARTS.boxes[kind]?.[view] || {};
  const W = res === 3 ? BODY_PARTS.w3 : BODY_PARTS.w, H = res === 3 ? BODY_PARTS.h3 : BODY_PARTS.h;
  const pct = v => `${Math.round(v * 1e5) / 1e3}%`;
  const on = BODY_PARTS.parts.filter(p => boxes[p.id] && levels[p.id] > 0);
  on.sort((a, b) => Number(!!a.deep) - Number(!!b.deep));
  return on.map(p => {
    const b = boxes[p.id][res === 3 ? 1 : 0], lv = levels[p.id];
    const url = `url(${body2Url(kind, view, `${res === 3 ? 'p3' : 'p'}/${p.id}.webp`)})`;
    const op = p.deep ? BODY_PART_DEEP_OPACITY : tiers ? 1 : lv >= 2 ? 1 : BODY_PART_SEC_OPACITY;
    const tone = tiers ? ` body-map__m--t${Math.min(BODY_TIERS, Math.max(1, lv))}` : lv >= 2 ? '' : ' body-map__m--sec';
    const cls = `body-map__m body-map__p${tone}${p.deep ? ' body-map__p--deep' : ''}`;
    return `<i class="${cls}" data-part="${p.id}" data-muscle="${p.parent || ''}" data-level="${lv}" style="left:${pct(b[0] / W)};top:${pct(b[1] / H)};width:${pct((b[2] - b[0]) / W)};height:${pct((b[3] - b[1]) / H)};background-image:${url};-webkit-mask-image:${url};mask-image:${url};opacity:${op}"></i>`;
  }).join('') + (outline.length ? bodyOutlineHtml(kind, view, outline, res) : '')
    // Fiche : le ciblé cerné d'un trait rouge d'un point (panel t8 : le haut des pectoraux, fin, se perdait dans le rose voisin)
    + (tiers ? '' : bodyOutlineHtml(kind, view, on.filter(p => !p.deep && levels[p.id] >= 2).map(p => p.id), res, 'body-map__ol--main', true));
}

// Contour net (environ 1,5 point, sans flou ni lueur) d'un sous-muscle : un anneau autour de sa forme, dessiné une fois
// dans un canvas (forme élargie moins la forme : bodyOutlineMask) et posé en masque sur un aplat --body-ol (couleur du
// thème). Avant, un filtre SVG (feMorphology) recalculé à chaque image : avec 32 muscles cernés (« Cette semaine »), une
// image prenait 300 ms sur le PC et plus de 10 s sur la CI (iPhone 17), la page ne se dessinait plus. Toujours d'après
// l'image 1× (audit M3 : en 3×, environ 18 Mo par vue ; agrandi dans la vue agrandie, un trait reste un trait), anneau de
// 4 pixels de l'image (1,5 point environ sur la carte), 3 pour l'anneau en dedans. res : ignoré (cadre de la vue)
const BODY_OL_PX = 4;
const bodyOutlineMasks = new Map();   // « sexe/vue/anneau/id » → adresse de l'anneau (blob:), une fois dessiné
// cls : classe en plus (marque du muscle touché, contour du ciblé de la fiche) ; inner : anneau d'un point environ, en
// dedans de la forme (ciblé de la fiche : il ne déborde pas sur le muscle qui aide voisin)
function bodyOutlineHtml(kind, view, ids, res = 1, cls = '', inner = false) {
  const boxes = BODY_PARTS.boxes[kind]?.[view] || {}, W = BODY_PARTS.w, H = BODY_PARTS.h;
  const r = inner ? 0 : BODY_OL_PX, ri = inner ? 3 : r;
  const pct = v => `${Math.round(v * 1e5) / 1e3}%`;
  return ids.filter(id => boxes[id]).map(id => {
    const b = boxes[id][0], key = `${kind}/${view}/${inner ? 'in' : ''}${ri}/${id}`, url = bodyOutlineMasks.get(key);
    if (!url) bodyOutlineMask(kind, view, id, ri, inner);
    const mask = url ? `-webkit-mask-image:url(${url});mask-image:url(${url})` : '';
    return `<span class="body-map__ol${cls ? ` ${cls}` : ''}" data-ol="${id}" data-olkey="${key}" style="left:${pct((b[0] - r) / W)};top:${pct((b[1] - r) / H)};width:${pct((b[2] - b[0] + 2 * r) / W)};height:${pct((b[3] - b[1] + 2 * r) / H)};${mask}"></span>`;
  }).join('');
}
// Dessine l'anneau (union de la forme décalée sur un cercle de rayon r, moins la forme ; en dedans : la forme moins sa
// forme rognée), le garde en image (blob) et le pose sur les contours qui l'attendent. Canvas vidés et image source
// oubliée ensuite : seule reste l'image de l'anneau
const bodyOutlinePending = new Set();
async function bodyOutlineMask(kind, view, id, r = BODY_OL_PX, inner = false) {
  const key = `${kind}/${view}/${inner ? 'in' : ''}${r}/${id}`;
  if (bodyOutlinePending.has(key) || typeof document === 'undefined' || !document.createElement) return;
  bodyOutlinePending.add(key);
  const src = body2Url(kind, view, `p/${id}.webp`), img = await bodyLoadImage(src);
  bodyImageCache.delete(src);
  const c = img && document.createElement('canvas'), m = inner ? 0 : r;
  const x = c?.getContext('2d');
  if (!x) { bodyOutlinePending.delete(key); return; }
  c.width = img.width + 2 * m; c.height = img.height + 2 * m;
  const around = draw => { for (let k = 0; k < 24; k++) { const a = k / 24 * 2 * Math.PI; draw(m + Math.round(r * Math.cos(a)), m + Math.round(r * Math.sin(a))); } };
  let e = null;
  if (inner) {
    e = document.createElement('canvas');
    const y = e.getContext('2d');
    e.width = c.width; e.height = c.height;
    y.drawImage(img, 0, 0);
    y.globalCompositeOperation = 'destination-in';
    around((dx, dy) => y.drawImage(img, dx, dy));
    x.drawImage(img, 0, 0);
    x.globalCompositeOperation = 'destination-out';
    x.drawImage(e, 0, 0);
  } else {
    around((dx, dy) => x.drawImage(img, dx, dy));
    x.globalCompositeOperation = 'destination-out';
    x.drawImage(img, r, r);
  }
  const blob = await new Promise(res => c.toBlob(res, 'image/png'));
  c.width = c.height = 0;
  if (e) e.width = e.height = 0;
  bodyOutlinePending.delete(key);
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  bodyOutlineMasks.set(key, url);
  document.querySelectorAll(`.body-map__ol[data-olkey="${key}"]`).forEach(el => {
    el.style.webkitMaskImage = `url(${url})`; el.style.maskImage = `url(${url})`;
  });
}

// Vues de la carte de la fiche : celles où un sous-muscle est coloré (abducteurs : le dos seul, en grand ; panel
// affichage-e t3), les deux sinon
function bodyAtlasViews(kind, levels) {
  const used = ['front', 'back'].filter(v => BODY_PARTS.parts.some(p => levels[p.id] > 0 && BODY_PARTS.boxes[kind]?.[v]?.[p.id]));
  return used.length === 1 ? used : ['front', 'back'];
}

// Carte de l'atlas, face et dos côte à côte, en texte HTML (même gabarit que bodyMapHtml : .body-map__row,
// .body-map__fig, d'où les mêmes places de bulle). levels : exercisePartLevels(…).levels (js/data/atlas.js).
// Options : body (personnage), className, title (nom de l'exercice, titre de la vue agrandie), tap (bulle
// du sous-muscle touché, zoom au double toucher ou au pincement : js/ui/body-zoom.js)
// Progrès (js/features/progress-atlas.js) : tiers (paliers au lieu de plein / qui aide), tip 'load' (bulle : volume de
// la période et exercices), crop false (corps entier, les deux vues), captions (« Face », « Dos » sous les vues),
// outline (sous-muscles cernés : bodyAtlasLayersHtml)
// one : la seule vue utile même sans cadrage (fiche en texte très grand : corps entier, mais le dos seul pour les abducteurs)
function bodyAtlasHtml(levels = {}, { body = bodySilhouette(), className = '', title = '', tap = false, tiers = false, tip = '', crop: cropOn = true, captions = false, outline = [], one = cropOn } = {}) {
  const kind = bodyKind(body), safe = levels && typeof levels === 'object' ? levels : {};
  const views = one ? bodyAtlasViews(kind, safe) : ['front', 'back'];
  const rowW = views.length + (views.length - 1) * BODY_GAP, fig = `${Math.round(10000 / rowW) / 100}%`;
  const [y0, y1] = cropOn ? bodyAtlasCrop(kind, safe) : [0, BODY_PARTS.h], ch = y1 - y0;
  const inner = `top:${Math.round(-y0 / ch * 1e5) / 1e3}%;height:${Math.round(BODY_PARTS.h / ch * 1e5) / 1e3}%`;
  const figs = views.map(v => `<span class="body-map__fig body-map__${v}"><span class="body-map__body" style="${inner}"><img class="body-map__base" src="${body2Url(kind, v, 'base.webp')}" alt="" draggable="false" decoding="async">${bodyAtlasLayersHtml(kind, v, safe, 1, tiers, outline)}</span></span>`).join('');
  const act = tap ? ' data-action="body-tap"' : '';
  const crop = ch < BODY_PARTS.h ? ' body-map--crop' : '';
  const extra = `${tiers ? ' data-tiers="1"' : ''}${tip ? ` data-tip="${esc(tip)}"` : ''}${views.length === 1 ? ` data-view="${views[0]}"` : ''}${outline.length ? ` data-ol="${esc(outline.join(' '))}"` : ''}`;
  const caps = captions ? `<span class="body-map__caps" aria-hidden="true" style="--fig:${fig}">${views.map(v => `<span>${v === 'front' ? 'Face' : 'Dos'}</span>`).join('')}</span>` : '';
  return `<div class="body-map body-map--atlas${crop}${views.length === 1 ? ' body-map--one' : ''} ${esc(className)}" data-body="${kind}" data-atlas="${esc(JSON.stringify(safe))}" data-crop="${y0},${y1}" data-title="${esc(title)}"${extra}${act} aria-hidden="true"><span class="body-map__row" style="aspect-ratio:${Math.round(rowW * BODY_PARTS.w)} / ${ch};--body-ar:${(rowW * BODY_PARTS.w / ch).toFixed(4)};--fig:${fig}">${figs}</span>${caps}</div>`;
}

// Cadrage de la carte de la fiche, en points 1× de la vue : [haut, bas]. Muscles travaillés tous dans le haut du
// corps : de la tête à la taille, le personnage paraît plus grand. Tous dans le bas (fessiers, jambes) : la boîte des
// sous-muscles colorés, avec une marge (taille et crête iliaque visibles au-dessus, au moins 300 points de haut), donc
// pas jusqu'aux pieds si rien n'y est coloré (panel atlas t2 : moyen fessier collé au bord). Sinon le corps entier.
// Le cadre contient chaque sous-muscle coloré (tests/unit/atlas.mjs).
const BODY_ATLAS_UPPER = [0, 450];    // tête → taille (abdominaux et obliques compris)
const BODY_ATLAS_LEG_TOP = 50, BODY_ATLAS_LEG_BOTTOM = 150, BODY_ATLAS_LEG_MIN = 300;
const BODY_ATLAS_LEGS = new Set(['glutes', 'quads', 'hamstrings', 'adductors', 'calves']);
const BODY_ATLAS_LEGS_OWN = new Set(['tfl', 'sartorius', 'tibialis', 'peroneus']);   // sans muscle parent
function bodyAtlasCrop(kind, levels) {
  const boxes = [];
  const on = BODY_PARTS.parts.filter(p => levels[p.id] > 0 && ['front', 'back'].some(v => BODY_PARTS.boxes[kind]?.[v]?.[p.id]));
  for (const p of on) for (const v of ['front', 'back']) { const b = BODY_PARTS.boxes[kind]?.[v]?.[p.id]; if (b) boxes.push(b[0]); }
  if (!on.length) return [0, BODY_PARTS.h];
  const top = Math.min(...boxes.map(b => b[1])), bot = Math.max(...boxes.map(b => b[3]));
  const legs = p => BODY_ATLAS_LEGS.has(p.parent) || BODY_ATLAS_LEGS_OWN.has(p.id);
  if (!on.some(legs) && bot <= BODY_ATLAS_UPPER[1]) return BODY_ATLAS_UPPER;
  if (on.every(legs)) {
    const y0 = Math.max(0, top - BODY_ATLAS_LEG_TOP);
    return [y0, Math.min(BODY_PARTS.h, Math.max(bot + BODY_ATLAS_LEG_BOTTOM, y0 + BODY_ATLAS_LEG_MIN))];
  }
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
      // Paliers de Progrès (colors.tier1, tier2 : profil du récap) : une couleur pleine par palier, comme bodyTier
      const tier = c.tier1 ? bodyTier(levels?.[m]) : null, op = c.tier1 ? (tier ? 1 : 0) : bodyHeatOpacity(levels?.[m]);
      if (!op) continue;
      const img = await bodyLoadImage(bodyImgUrl(kind, v, m));
      if (!img) return null;
      f.globalAlpha = op;
      f.drawImage(bodyTintLayer(img, tier ? c[`tier${tier.tone.slice(1)}`] : c.peak && levels[m] >= 1 ? c.peak : c.heat), 0, 0, w, h);
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
